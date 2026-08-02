// Ocean surface (Snell's window), volumetric god rays, particulates, bubble vents,
// and the depth-absorption atmosphere model.
// OWNED BY: water/atmosphere agent.
import * as THREE from 'three';
import { scene, camera } from '../core.js';
import { WORLD_R, SURFACE_Y } from '../config.js';
import { rng, clamp } from '../lib/math.js';
import { scatter } from './flora.js';

export let surface = null;
export const rays = [];
export const bubbles = { pts: null, data: [] };
export let snow = null;

// ---------------------------------------------------------------------------
// Water optics
// ---------------------------------------------------------------------------
// Beer-Lambert absorption of the downwelling sunlight column, per world unit
// (1 unit ~= 3 m of displayed depth). Red dies first, then green; blue carries
// deepest. Roughly 5x gentler than real clear seawater so the trench stays legible.
// Green sits well below red so green light carries deep — the luminous mid-water of the
// reference frame. Red still dies fast, which is what keeps warm accents punchy up close.
const K_ABS = [0.0520, 0.0062, 0.0042];
// Relative extinction along the *viewing* path (turbidity), scaled by fog.density.
// This is the MOLECULAR spectrum: it is what clear water does. See K_PART below for
// the mineral half.
const K_EXT = [3.50, 1.45, 1.00];

// ---------------------------------------------------------------------------
// THE SILT LINE — the water column is stratified, not uniform.
// ---------------------------------------------------------------------------
// rho(y) = rhoClear(y) + amp * min(1, exp(-(y - yf)/hs))
//
// A nepheloid layer pools on each seabed under genuinely clearer water, so the murk
// has a CEILING and rising out of it is the reveal. amp is solved per zone so the
// GREEN extinction at the STANDING CAMERA equals the old flat model's value EXACTLY.
// That height is floor + EYE_H + CAM_UP = 3.75, NOT the eye at 1.35: updateAtmosphere
// is keyed on camera.position.y (game.js), so the camera is what the profile is
// sampled at. Calibrating at the eye instead left the floors 4-5% thinner than the old
// model — measured live at -4.1/-5.1/-4.6% — which also carried every additive glow
// that reads fog.density (creatures, predators, tools) 5% further than tuned.
// Where Sal walks is preserved by construction; what changes is the room above him.
// Green visibility on rising: 1.9x in zone 0, 3.4x in zone 1, 4.8x in zone 2.
//
// The clear column is linear in y, so its exact path mean is the profile at the
// segment MIDPOINT — free, no exp at all. RC_MIN's floor lands at y = -1111, which
// is 231 units below the deepest terrain; it exists only to guarantee positivity.
const RC0 = 0.00780, RC_K = 0.00072, RC_MIN = 0.20;
// Per zone: yf (datum), hs (scale height), amp. Selected by CAMERA height and blended
// over the inter-zone gaps — see nephParams/nephAt.
const NEPH_YF = [-246, -552, -836];
const NEPH_HS = [24, 30, 38];
const NEPH_AMP = [0.00810, 0.01776, 0.02626];

// --- A/B KILL SWITCH: THE WARM NEAR FIELD IS A TASTE CALL -------------------
// These THREE values, and only these three, buy the mineral colour. Change them to
//     const K_PART = K_EXT;
//     const SILT_MIX = 0.00, SILT_GAIN = 1.00;
// and the whole system collapses to pure DENSITY stratification with BYTE-IDENTICAL
// colour: same fog tint, same dome, same everything the old model drew, with only the
// vertical structure added. Nothing else needs touching, in this file or any other.
// What they cost: the near field at the floor shifts warm — red 2% reach goes 84 -> 105
// units in zone 0, 55 -> 79 in zone 1, 42 -> 64 in zone 2, and silt inscatter lifts
// luminance ~19%. Green is byte-identical at every floor either way. That warmth is
// physically right for mineral particulate (red is the channel silt scatters back
// rather than absorbs) but it is a LOOK change in the one region the brief said to
// preserve, so it gets A/B'd against the reference screenshots, not argued about.
const K_PART = [2.10, 1.44, 1.12];   // green matched to 1%, red 1.67x more transmissive
const SILT_MIX = 0.62, SILT_GAIN = 1.08;
// ---------------------------------------------------------------------------
// Surface irradiance tint; scene.fog.color carries it, everything else derives from it.
// Green-dominant at the surface (coastal teal) — absorption alone turns it blue with depth.
// These are scene-linear radiances, and they stay linear all the way to the canvas:
// see the note on SKY_ZEN_D below — nothing in this pipeline actually tone-maps.
const SURF_LIGHT = [0.055, 0.135, 0.112];
// ONE sun. This is lighting.js's `sun.position` (0.2, 1, 0.1) normalised: adopting the
// light's vector rather than the surface's old (0.20, 0.94, 0.16) leaves the directional
// light and the volumetric phase lobe byte-identical and retunes only the refracted disc,
// which is the cheap side. Measured disagreement before this: 3.9 degrees surface-vs-light,
// 26.5 degrees surface-vs-billboard-shafts (the shafts also leaned the wrong way; fixed
// in buildRays below).
const SUN_DIR = new THREE.Vector3(0.20, 1.00, 0.10).normalize();
// Shafts descend ALONG the sunlight, so as they drop by h they move by -sunDir.xz/sunDir.y.
const SUN_PROJ = [SUN_DIR.x / SUN_DIR.y, SUN_DIR.z / SUN_DIR.y];

// Sky radiance seen through the interface, night -> day. These are raw scene-linear
// values: verified live that NOTHING in this pipeline tone-maps (0 of 121 compiled
// programs contain ACESFilmicToneMapping — three only injects it when rendering to the
// canvas, and the composer renders to targets), so what a material writes is what
// BloomEffect thresholds at 0.28. The window interior is deliberately kept just under
// that; only the sun disc, its aureole and the compressed horizon ring cross it.
// Horizon 4.3x the zenith: the whole point is that the window has an IMAGE in it, and
// the horizon ring is the only structural landmark the sky offers. Measured through the
// full Fresnel composite that lands as a 0.35 ring against a 0.15 centre.
const SKY_ZEN_D = [0.090, 0.155, 0.310], SKY_HOR_D = [0.620, 0.660, 0.720];
// Night is not the true ~1e-5: game.js floors the surface irradiance at 0.20 of noon so
// the world stays legible, and the sky has to sit consistently below the water that sky
// is supposed to be lighting, or the window inverts into a bright lid again.
const SKY_ZEN_N = [0.0045, 0.0068, 0.0135], SKY_HOR_N = [0.0165, 0.0180, 0.0210];
const SUN_DISC = [3.4, 3.0, 2.3], MOON_DISC = [0.30, 0.34, 0.42];

const f = v => v.toFixed(5);
const v3 = a => `vec3(${f(a[0])},${f(a[1])},${f(a[2])})`;
const v2 = a => `vec2(${f(a[0])},${f(a[1])})`;

const GLSL_NOISE = `
float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*0.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float vn(vec2 p){vec2 i=floor(p),g=fract(p);g=g*g*(3.0-2.0*g);
return mix(mix(h21(i),h21(i+vec2(1,0)),g.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),g.x),g.y);}
float fbm2(vec2 p){float v=0.0,a=0.5;for(int i=0;i<4;i++){v+=a*vn(p);p*=2.07;a*=0.5;}return v;}`;

// Ambient (fully scattered) water radiance at world height y. Evaluated per fragment,
// so one frame can show teal overhead and ink below at the same time.
const GLSL_AMBIENT = `
vec3 zoneGlow(float y){
  float t=clamp(-y/900.0,0.0,1.0);
  vec3 g=mix(vec3(0.0060,0.0210,0.0185),vec3(0.0102,0.0043,0.0203),smoothstep(0.20,0.52,t));
  g=mix(g,vec3(0.0197,0.0067,0.0040),smoothstep(0.62,0.92,t));
  // Floor the scatter so open mid-water is always legibly coloured. Without it the
  // sunlight term dies by ~60 units and empty water tone-maps to pure black, which
  // reads as a rendering fault rather than as darkness.
  return g*(0.15+0.85*smoothstep(0.03,0.30,t));
}
vec3 abyssaAmbient(vec3 surf,float y){
  return surf*exp(${v3(K_ABS)}*min(y,0.0))+zoneGlow(y);
}`;

// The stratified water profile, shared VERBATIM by the fog chunk and the background
// dome. It has to be both places: the fog chunk's L -> infinity asymptote and the
// dome converge on the identical value only because they evaluate the same functions
// at the same height. (Injecting it into one shader and not the other is not a subtle
// bug — the other one fails to link and there is no background at all.)
const GLSL_WATER = `
#define RC0 ${f(RC0)}
#define RC_K ${f(RC_K)}
#define RC_MIN ${f(RC_MIN)}
#define KMOL ${v3(K_EXT)}
#define KPART ${v3(K_PART)}

float rhoClearAt( float y ){ return RC0 * max( RC_MIN, 1.0 + RC_K * y ); }

// Both edges ASCEND. GLSL smoothstep is UNDEFINED for edge0 >= edge1: the inverted
// form works on some drivers and produces garbage on others, presenting as
// zone-dependent fog corruption on one machine only.
void nephParams( float yc, out float yf, out float hs, out float amp ){
  float t1 = 1.0 - smoothstep( -400.0, -300.0, yc );
  float t2 = 1.0 - smoothstep( -710.0, -610.0, yc );
  yf  = mix( mix( ${f(NEPH_YF[0])}, ${f(NEPH_YF[1])}, t1 ), ${f(NEPH_YF[2])}, t2 );
  hs  = mix( mix( ${f(NEPH_HS[0])}, ${f(NEPH_HS[1])}, t1 ), ${f(NEPH_HS[2])}, t2 );
  amp = mix( mix( ${f(NEPH_AMP[0])}, ${f(NEPH_AMP[1])}, t1 ), ${f(NEPH_AMP[2])}, t2 );
}

// Antiderivative of the SATURATING shape min(1, exp(-s)). The exp argument is
// ALWAYS <= 0, so this cannot overflow. The saturation is what stops the layer
// amplifying without bound below its own datum -- that amplification is what made
// the naive exponential give 22-unit visibility in the open water between zones,
// which is exactly where every zone transition happens.
float nephG( float s, out float e ){
  e = exp( -max( s, 0.0 ) );
  return min( s, 0.0 ) + 1.0 - e;
}

// Local silt share of the GREEN extinction. A PURE FUNCTION OF y -- that is what
// makes the dome and the fog chunk agree at L -> infinity, analytically, at every
// elevation. Do not reintroduce an optical-depth-share version: as a share of the
// RAY's optical depth it drifts with distance, so two pixels straddling a silhouette
// get different tints.
float murkFracAt( float y, float yf, float hs, float amp ){
  float m = amp * exp( -max( ( y - yf ) / hs, 0.0 ) ) * KPART.g;
  return m / ( rhoClearAt( y ) * KMOL.g + m );
}

// Mineral inscatter: silt scatters back warm and lifts luminance. See the A/B kill
// switch beside K_PART in water.js -- at SILT_MIX 0.0 / SILT_GAIN 1.0 this is the
// identity function and the whole system is pure density stratification.
vec3 siltTint( vec3 A, float fm ){
  float lum = dot( A, vec3( 0.2126, 0.7152, 0.0722 ) );
  return mix( A, mix( A, lum * vec3( 1.42, 1.16, 0.72 ), ${f(SILT_MIX)} ) * ${f(SILT_GAIN)}, fm );
}`;

// Weather scaling of the surface irradiance (set by game.js): night and storms dim
// what reaches the water; the zoneGlow floor is untouched so the deep stays itself.
// The surface material needs day/storm/flash as well, or the sky in Snell's window is
// the same radiance at midnight as at noon (it was: byte-identical, which made the sky
// hole ~3x MORE conspicuous at night than at noon).
//   murk IS wx.storm — game.js already passes it.
//   day and flash are optional. Until game.js passes them, day is recovered by inverting
//   the exact expression game.js:315 builds surfK from. That inversion is only valid
//   while that expression is; passing day/flash explicitly is a one-line wiring change
//   and is the preferred form.
let wSurfK = 1, wMurk = 0, rayDim = 1, wDay = 1, wFlash = 0;
export function setWeatherWater(surfK, murk, day, flash) {
  wSurfK = surfK; wMurk = murk;
  wDay = day !== undefined ? day
    : clamp((surfK / Math.max(0.35, 1 - 0.45 * murk) - 0.20) / 0.80, 0, 1);
  wFlash = flash || 0;
}
export function setRayDim(k) { rayDim = k; }

// CPU mirror of abyssaAmbient, for scene.background and the returned tint.
const ms = THREE.MathUtils.smoothstep, ml = THREE.MathUtils.lerp;
// Night->day sky lerp, then storm gain and desaturation, written in place (no allocation).
function mixSky(v, N, D, day, gain, desat) {
  const x = ml(N[0], D[0], day) * gain, y = ml(N[1], D[1], day) * gain, z = ml(N[2], D[2], day) * gain;
  const l = 0.2126 * x + 0.7152 * y + 0.0722 * z;
  v.set(ml(x, l, desat), ml(y, l, desat), ml(z, l, desat));
}
function ambientAt(y, out) {
  const t = clamp(-y / 900, 0, 1);
  const a = ms(t, 0.20, 0.52), b = ms(t, 0.62, 0.92), c = ms(t, 0.03, 0.30), d = Math.min(0, y);
  return out.setRGB(
    SURF_LIGHT[0] * wSurfK * Math.exp(K_ABS[0] * d) + ml(ml(0.0020, 0.0064, a), 0.0123, b) * c,
    SURF_LIGHT[1] * wSurfK * Math.exp(K_ABS[1] * d) + ml(ml(0.0073, 0.0027, a), 0.0042, b) * c,
    SURF_LIGHT[2] * wSurfK * Math.exp(K_ABS[2] * d) + ml(ml(0.0115, 0.0127, a), 0.0025, b) * c,
    THREE.LinearSRGBColorSpace
  );
}

// CPU mirror of GLSL_WATER — ONE source of truth: both read the same constants above,
// so the shader and the JS cannot drift. This is what drives scene.fog.density (the
// true local total at the eye, which is why creatures/predators/tools/volumetrics need
// no edits) and uExtG.
// Note THREE.MathUtils.smoothstep takes (x, min, max), not GLSL's (edge0, edge1, x).
export function rhoClearAt(y) { return RC0 * Math.max(RC_MIN, 1 + RC_K * y); }
// Returns a module-scoped object: called every frame, and this file allocates nothing
// in a hot path. Do not hold the reference across a second nephAt() call.
const _neph = { yf: 0, hs: 0, amp: 0 };
export function nephAt(y) {
  const t1 = 1 - ms(y, -400, -300), t2 = 1 - ms(y, -710, -610);
  _neph.yf = ml(ml(NEPH_YF[0], NEPH_YF[1], t1), NEPH_YF[2], t2);
  _neph.hs = ml(ml(NEPH_HS[0], NEPH_HS[1], t1), NEPH_HS[2], t2);
  _neph.amp = ml(ml(NEPH_AMP[0], NEPH_AMP[1], t1), NEPH_AMP[2], t2);
  return _neph;
}
const nephShape = (y, n) => n.amp * Math.exp(-Math.max((y - n.yf) / n.hs, 0));
export function waterRho(y) { const n = nephAt(y); return rhoClearAt(y) + nephShape(y, n); }
export function waterExtG(y) {
  const n = nephAt(y);
  return rhoClearAt(y) * K_EXT[1] + nephShape(y, n) * K_PART[1];
}
// Silt share of the green extinction: 0 in clear water, ~0.53/0.78/0.89 on the three
// floors. Drives the particulate density, so the grit visibly thins as Sal climbs out.
export function murkFrac(y) {
  const n = nephAt(y), m = nephShape(y, n) * K_PART[1];
  return m / (rhoClearAt(y) * K_EXT[1] + m);
}

// Replace three's grey-mix fog with per-channel Beer-Lambert extinction plus
// depth-tinted inscatter. scene.fog stays a FogExp2 so USE_FOG / FOG_EXP2 and the
// fogColor / fogDensity uniform plumbing keep working on every built-in material.
// NOTE: fogColor now means "surface irradiance", not "colour of the far field".
(function patchFog() {
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogY;
#endif`;
  // viewMatrix[1].xyz is row 1 of the inverse view rotation, so world height comes back
  // without needing worldpos_vertex (which is not emitted by every material).
  C.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogY = dot( viewMatrix[ 1 ].xyz, mvPosition.xyz ) + cameraPosition.y;
#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying float vFogY;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
${GLSL_AMBIENT}
${GLSL_WATER}
#endif`;
  // The inscatter is dominated by the near end of a long ray, so weight the sample
  // height by extinction: wgt = 1/a - 1/(e^a - 1), which tends to 1/2 for short rays
  // and to 1/a for deep ones. Under the OLD uniform medium that made an infinitely
  // distant surface land on exactly what the dome draws. Stratified it no longer can:
  // wgt uses the ray's PATH-mean extinction while the dome's uReach is the camera's
  // LOCAL mean free path, and in a layered column those differ off the horizontal.
  // Measured (shipped GLSL, black object at camera.far against the dome): 0 code
  // values at the horizon at every depth, 0-3 up to 15 degrees, worst 7-8 at 45-80
  // degrees from a FLOOR, and 0-2 everywhere in the clear bands. The silt TINT half
  // does agree exactly by construction — murkFracAt is a pure function of height, so
  // both sides evaluate the same number at their own sample point. See the report.
  C.fog_fragment = `#ifdef USE_FOG
  {
    #ifdef FOG_EXP2
      float dens = fogDensity;
    #else
      float dens = 1.0 / max( 1.0, fogFar - fogNear );
    #endif
    float yf, hs, amp;
    nephParams( cameraPosition.y, yf, hs, amp );
    float s0 = ( cameraPosition.y - yf ) / hs;
    float s1 = ( vFogY - yf ) / hs;
    float e0, e1;
    float g0 = nephG( s0, e0 );
    float g1 = nephG( s1, e1 );
    float ds = s1 - s0;
    // Below |ds| = 0.02 the difference of two nearly equal G values loses fp32;
    // above it the quotient is EXACT for every ray, including one straddling the
    // saturation kink. Verified in emulated fp32 against a 400k-sample integration:
    // worst relative error anywhere 1.77e-3 (on a term worth 3.4e-4 of amp),
    // 1.67e-5 at the crossover. There is no 0/0 branch to guard.
    float shp = abs( ds ) > 0.02 ? ( g1 - g0 ) / ds
                                 : exp( -max( 0.5 * ( s0 + s1 ), 0.0 ) );

    // fogDensity is the TRUE LOCAL total density at the eye -- unchanged meaning for
    // creatures.js, predators.js, tools.js (uFogD) and postfx.volumetrics.js (uDens),
    // all four of which keep working with NO edit. Invert the profile at the eye to
    // recover the storm gain: e0 is already computed by nephG, so weather coupling
    // costs one divide and zero extra transcendentals.
    float storm = dens / max( rhoClearAt( cameraPosition.y ) + amp * e0, 1e-6 );

    // Clear column is linear in y, so its exact path mean is the midpoint value.
    float ic  = vFogDepth * rhoClearAt( 0.5 * ( cameraPosition.y + vFogY ) ) * storm;
    float im  = vFogDepth * amp * shp * storm;
    vec3  tau = ic * KMOL + im * KPART;
    vec3  tr  = exp( -tau );

    // series form below 0.6: the closed form is two large reciprocals that cancel,
    // which loses all precision in fp32 on nearby geometry
    float ea  = clamp( tau.g, 1e-4, 30.0 );
    float wgt = ea < 0.6 ? 0.5 - ea * 0.0833333 + ea * ea * ea * 0.0013889
                         : 1.0 / ea - 1.0 / ( exp( ea ) - 1.0 );
    float ay  = cameraPosition.y + ( vFogY - cameraPosition.y ) * wgt;

    vec3 J = siltTint( abyssaAmbient( fogColor, ay ), murkFracAt( ay, yf, hs, amp ) );
    gl_FragColor.rgb = gl_FragColor.rgb * tr + J * ( 1.0 - tr );
  }
#endif`;
})();

const fogUniforms = () => THREE.UniformsUtils.clone(THREE.UniformsLib.fog);

// ---------------------------------------------------------------------------
let dome = null, rayMesh = null;
const snowLayers = [];
const uTime = { value: 0 };
const uCam = { value: new THREE.Vector3() };
const uExtG = { value: 0.024 };          // green-channel extinction, for manual fades
const uRayFade = { value: 0.55 };
const uLightPos = { value: new THREE.Vector3() };
const _tmp = new THREE.Vector3();
const _size = new THREE.Vector2();
const _outCol = new THREE.Color();

function pixScale(r, cam) {
  r.getSize(_size);
  return _size.y * r.getPixelRatio() / (2 * Math.tan(cam.fov * Math.PI / 360));
}

// ---------------------------------------------------------------------------
// Background dome: the far field, shaded by the same absorption model so empty
// water reads as an unbounded volume instead of a flat clear colour.
// ---------------------------------------------------------------------------
function buildDome() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSurf: { value: new THREE.Vector3(...SURF_LIGHT) },
      uReach: { value: 46 }, uTime, uSunGlow: { value: new THREE.Vector3() }
    },
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir;
      void main(){ vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        gl_Position = vec4( p.xy, p.w * 0.999999, p.w ); }`,
    fragmentShader: `uniform vec3 uSurf, uSunGlow; uniform float uReach, uTime;
      varying vec3 vDir;
      ${GLSL_NOISE}
      ${GLSL_AMBIENT}
      ${GLSL_WATER}
      void main(){
        vec3 d = normalize( vDir );
        // uReach is one mean free path: the extinction-weighted height this ray samples.
        // murkFracAt is a PURE FUNCTION of that height, so the silt tint here and the
        // silt tint the fog chunk reaches at L -> infinity are the same number by
        // construction -- no magic path length, and no view-dependent tint where two
        // pixels straddle a silhouette. That is what a fixed "four mean free paths"
        // composite could not do. The residual step is in ay itself, not in the tint:
        // see the note above C.fog_fragment for the measured numbers.
        float ay = cameraPosition.y + d.y * uReach;
        float yf, hs, amp;
        nephParams( cameraPosition.y, yf, hs, amp );
        vec3 c = siltTint( abyssaAmbient( uSurf, ay ), murkFracAt( ay, yf, hs, amp ) );
        float up = max( 0.0, d.y );
        c += uSunGlow * ( up * up * up + 0.25 * up );
        // volume texture, faded out near the horizon so the ocean plane's far edge
        // blends into the dome without a step
        vec2 q = d.xz / max( 0.30, abs( d.y ) + 0.22 );
        float na = 0.16 * smoothstep( 0.05, 0.42, abs( d.y ) );
        c *= 1.0 - na * 0.5 + na * fbm2( q * 2.0 + vec2( uTime * 0.012, uTime * 0.008 ) );
        gl_FragColor = vec4( c, 1.0 );
      }`
  });
  dome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
  dome.frustumCulled = false;
  dome.renderOrder = 900;   // last opaque draw, so early-z rejects everything already covered
  dome.onBeforeRender = (r, s, cam) => {
    dome.position.copy(cam.position);
    dome.updateMatrix();
    dome.matrixWorld.copy(dome.matrix);
  };
  scene.add(dome);
}

// ---------------------------------------------------------------------------
// God rays: cylindrically billboarded additive shafts whose positions wrap around
// the camera, so shaft density stays constant wherever the diver swims.
// ---------------------------------------------------------------------------
const RAY_N = 48, RAY_L = 205;

function buildRays() {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(RAY_N * 6 * 3);
  const cen = new Float32Array(RAY_N * 6 * 3);
  const par = new Float32Array(RAY_N * 6 * 4);
  const CS = [[-1, 0], [1, 0], [1, 1], [-1, 0], [1, 1], [-1, 1]];
  for (let i = 0; i < RAY_N; i++) {
    const cx = Math.random() * RAY_L, cz = Math.random() * RAY_L;
    const hw = rng(1.4, 4.8), len = rng(120, 250), sd = Math.random();
    for (let k = 0; k < 6; k++) {
      const o = i * 6 + k;
      pos[o * 3] = CS[k][0]; pos[o * 3 + 1] = CS[k][1];
      cen[o * 3] = cx; cen[o * 3 + 1] = SURFACE_Y - 1.0; cen[o * 3 + 2] = cz;
      par[o * 4] = hw; par[o * 4 + 1] = len; par[o * 4 + 2] = rng(0, 40); par[o * 4 + 3] = sd;
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCenter', new THREE.BufferAttribute(cen, 3));
  g.setAttribute('aParam', new THREE.BufferAttribute(par, 4));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime, uCam, uExtG, uFade: uRayFade,
      uColor: { value: new THREE.Vector3(0.36, 0.55, 0.68) }
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, fog: false,
    vertexShader: `uniform vec3 uCam; uniform float uFade, uExtG;
      attribute vec3 aCenter; attribute vec4 aParam;
      varying vec2 vUv; varying float vSeed, vFade;
      void main(){
        vec2 w = mod( aCenter.xz - uCam.xz + ${f(RAY_L * 0.5)}, ${f(RAY_L)} ) - ${f(RAY_L * 0.5)} + uCam.xz;
        vec3 c = vec3( w.x, aCenter.y, w.y );
        vec2 d = uCam.xz - c.xz; float l = length( d );
        vec3 rt = l > 0.001 ? vec3( -d.y, 0.0, d.x ) / l : vec3( 1.0, 0.0, 0.0 );
        float v = position.y;
        vec3 wp = c + rt * ( position.x * aParam.x * ( 1.0 + v * 1.35 ) );
        wp.y -= v * aParam.y;
        // shafts lean ALONG the sunlight: light from a sun at (+x,+z) travels toward
        // (-x,-z) on the way down, so this is a minus. It used to be a plus with a
        // hand-picked vector, which aimed the shafts 26 degrees off and 180 out.
        wp.xz -= ${v2(SUN_PROJ)} * ( v * aParam.y );
        float dist = distance( wp, uCam );
        vFade = uFade
          * smoothstep( ${f(RAY_L * 0.5)}, ${f(RAY_L * 0.30)}, dist )   // hides the wrap boundary
          * smoothstep( 8.0, 34.0, dist )                               // no near-plane slicing
          * exp( -dist * uExtG );
        vUv = vec2( position.x, v ); vSeed = aParam.w;
        gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime;
      varying vec2 vUv; varying float vSeed, vFade;
      ${GLSL_NOISE}
      void main(){
        float x = vUv.x, v = vUv.y;
        float edge = 1.0 - x * x; edge = edge * edge * edge;
        float n  = fbm2( vec2( x * 1.2 + vSeed * 27.0, v * 2.6 - uTime * 0.055 + vSeed * 13.0 ) );
        float n2 = vn(   vec2( x * 3.4 + vSeed * 5.0,  v * 8.0 - uTime * 0.14 ) );
        float a = edge * smoothstep( 0.0, 0.05, v ) * pow( max( 0.0, 1.0 - v ), 1.7 )
                * ( 0.24 + 0.95 * n + 0.28 * n2 ) * vFade;
        if ( a <= 0.0025 ) discard;
        gl_FragColor = vec4( uColor, a );
      }`
  });
  rayMesh = new THREE.Mesh(g, mat);
  rayMesh.frustumCulled = false;
  rayMesh.renderOrder = 4;
  rayMesh.onBeforeRender = (r, s, cam) => uCam.value.copy(cam.position);
  scene.add(rayMesh);
  rays.push({ m: rayMesh, ph: 0 });   // legacy handle
}

// ---------------------------------------------------------------------------
// Particulates: two GPU-wrapped layers of suspended matter. Positions live in a
// box that follows the camera modulo its own size, so density stays constant and
// nothing is simulated on the CPU.
// ---------------------------------------------------------------------------
// extK scales the along-ray extinction the layer fades under. The near layer keeps
// 0.75; the far one runs 0.45 so it can survive out to 250 units in the clear water
// above the silt line — that mid-field is empty otherwise, and clear water is what
// exposes it.
function snowLayer(N, L, sizeMul, alpha, fall, colA, colB, extK = 0.75) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(N * 3), s = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    p[i * 3] = Math.random() * L; p[i * 3 + 1] = Math.random() * L; p[i * 3 + 2] = Math.random() * L;
    // seed.x biases size (squared: mostly grit, a few big detritus flakes), y speed, z tint
    s[i * 3] = Math.random(); s[i * 3 + 1] = Math.random(); s[i * 3 + 2] = Math.random();
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(s, 3));

  const u = {
    uTime, uCam, uExtG, uLightPos,
    uL: { value: L }, uSize: { value: sizeMul }, uAlpha: { value: alpha },
    uFall: { value: fall }, uPix: { value: 900 }, uDepth: { value: 0.5 },
    uExtK: { value: extK },
    uColA: { value: new THREE.Vector3(...colA) }, uColB: { value: new THREE.Vector3(...colB) }
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `uniform vec3 uCam, uLightPos, uColA, uColB;
      uniform float uTime, uL, uSize, uAlpha, uFall, uPix, uExtG, uDepth, uExtK;
      attribute vec3 aSeed;
      varying float vA; varying vec3 vC;
      void main(){
        vec3 p = position;
        p.y -= uTime * uFall * ( 0.45 + aSeed.y );
        p.x += sin( uTime * 0.21 + aSeed.z * 39.0 ) * 1.7;
        p.z += cos( uTime * 0.17 + aSeed.z * 23.0 ) * 1.7;
        vec3 w = mod( p - uCam + uL * 0.5, uL ) - uL * 0.5 + uCam;
        vec4 mv = viewMatrix * vec4( w, 1.0 );
        float dist = -mv.z;
        gl_PointSize = clamp( ( 0.25 + aSeed.x * aSeed.x * 2.0 ) * uSize * uPix / max( dist, 0.4 ), 0.7, 22.0 );
        vec3 dl = w - uLightPos;
        float lb = exp( -dot( dl, dl ) * 0.006 );   // the lantern picking grit out of the dark
        vA = uAlpha * uDepth
           * smoothstep( uL * 0.5, uL * 0.32, length( w - uCam ) )
           * smoothstep( 0.5, 3.0, dist )
           * exp( -dist * uExtG * uExtK );
        vC = mix( uColA, uColB, aSeed.z ) * ( 0.45 + 2.6 * lb );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA; varying vec3 vC;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float a = exp( -dot( q, q ) * 13.0 ) * vA;
        if ( a <= 0.003 ) discard;
        gl_FragColor = vec4( vC, a );
      }`
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  pts.onBeforeRender = (r, s2, cam) => { uCam.value.copy(cam.position); u.uPix.value = pixScale(r, cam); };
  snowLayers.push(u);
  return pts;
}

// ---------------------------------------------------------------------------
// Ocean surface seen from beneath: Snell's window, total internal reflection,
// a refracted sun disc and chop. No reflection render target.
// ---------------------------------------------------------------------------
// Deep-water gravity-wave spectrum. omega = sqrt(g*k) with one world unit = 3 m, so the
// 62-unit swell runs an 11 s period and the 6.5-unit chop a 3.5 s one: the components
// slide past each other and the field never reads as one rigid scrolling texture. (The
// four sines this replaced moved at unrelated hand-picked rates and had NO storm input,
// so a gale and a dead calm produced the identical 3.99-unit peak-to-peak field.)
//   lambda (u), direction (deg), amplitude calm, amplitude storm, retirement radius
// Storm peak-to-peak is 4.23 u against calm's 1.32. The storm figure is deliberately held
// at roughly the OLD field's amplitude rather than the ~6.9 u a real wind sea would want:
// player.js clamps the swim ceiling to y = -1.2 and game.js's camera sits up to 2.4 u
// above that, so a taller field would put the interface through the camera at the raft.
const WAVE = [
  [62.0, 20, 0.300, 0.900, 420],
  [41.0, 44, 0.180, 0.580, 260],
  [27.0, -11, 0.100, 0.340, 170],
  [17.0, 67, 0.050, 0.175, 110],
  [11.0, -38, 0.022, 0.082, 70],
  [6.5, 91, 0.010, 0.036, 45]
];
const DISP = Math.sqrt(9.81 / 3);   // k is per world unit and a unit is 3 m: omega = sqrt(g*k/3)

// Unrolled from JS because GLSL ES 1.00 (what three compiles a plain ShaderMaterial as)
// has no array constructors — `const float A[6] = float[6](...)` is a 3.00-only form.
// `dist` retires each component before the mesh stops resolving it; see WAVE above and
// the ring-spacing note in buildSurfaceGeo.
function waveSum(n) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const [lam, deg, a0, a1, fr] = WAVE[i];
    const k = 2 * Math.PI / lam, w = DISP * Math.sqrt(k), a = deg * Math.PI / 180;
    const dx = Math.cos(a), dz = Math.sin(a);
    s += `\n  { float amp=mix(${f(a0)},${f(a1)},sm)*(1.0-smoothstep(${f(fr * 0.5)},${f(fr)},dist));
    float q=(p.x*${f(dx)}+p.y*${f(dz)})*${f(k)}+t*${f(w)};
    h+=amp*sin(q); g+=${v2([dx, dz])}*(amp*${f(k)}*cos(q)); }`;
  }
  return s;
}
// Vertex pass: the three components the mesh can actually carry as geometry.
const GLSL_WAVE_V = `
float waveH( vec2 p, float t, float storm, float dist ){
  float sm=smoothstep(0.0,0.90,storm), h=0.0; vec2 g=vec2(0.0);${waveSum(3)}
  return h;
}`;
// Fragment pass: all six, height and analytic gradient. The gradient is the normal, and
// the normal is the whole image — it decides refraction, reflection and Fresnel at once.
const GLSL_WAVE_F = `
vec3 waveHN( vec2 p, float t, float storm, float dist ){
  float sm=smoothstep(0.0,0.90,storm), h=0.0; vec2 g=vec2(0.0);${waveSum(6)}
  return vec3(h,g);
}`;

// Camera-centred polar disc, exponentially spaced rings. The old uniform 820x820 grid
// spent 34,848 triangles at a flat 6.21 u pitch: far too coarse at 5 units away (where
// the diver actually meets the interface) and absurdly dense at 400 (where fog has eaten
// it). This gives 0.085 u cells at r = 1.2 and 32 u at r = 460 in 22,400 triangles.
// Ring spacing is 0.0708*r everywhere, so each WAVE component is kept at >= 4 vertices
// per wavelength wherever it is at full amplitude and tapered to zero before it drops
// under Nyquist — which matters more here than usual, because the mesh is camera-anchored
// while the field is world-anchored, so any aliasing would CRAWL as the diver swims.
// Sectors index modulo NS, so there is no duplicated seam ring and no crack at theta = 0.
function buildSurfaceGeo() {
  const R0 = 1.2, RMAX = 460, NR = 88, NS = 128;
  const ratio = Math.pow(RMAX / R0, 1 / (NR - 1));
  const pos = new Float32Array((NR * NS + 1) * 3);   // vertex 0 is the centre, at r = 0
  for (let i = 0; i < NR; i++) {
    const r = R0 * Math.pow(ratio, i);
    for (let s = 0; s < NS; s++) {
      const a = s * Math.PI * 2 / NS, o = (1 + i * NS + s) * 3;
      pos[o] = Math.cos(a) * r; pos[o + 2] = Math.sin(a) * r;
    }
  }
  const idx = new Uint16Array(NS * 3 + (NR - 1) * NS * 6);
  let k = 0;
  for (let s = 0; s < NS; s++) { idx[k++] = 0; idx[k++] = 1 + s; idx[k++] = 1 + (s + 1) % NS; }
  for (let i = 0; i < NR - 1; i++) for (let s = 0; s < NS; s++) {
    const a0 = 1 + i * NS + s, a1 = 1 + i * NS + (s + 1) % NS;
    idx[k++] = a0; idx[k++] = a0 + NS; idx[k++] = a1 + NS;
    idx[k++] = a0; idx[k++] = a1 + NS; idx[k++] = a1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), RMAX * 1.05);
  return g;
}

function buildSurface() {
  const u = Object.assign(fogUniforms(), {
    uTime, uCam,
    uSunDir: { value: SUN_DIR.clone() },
    uSkyZen: { value: new THREE.Vector3(...SKY_ZEN_D) },
    uSkyHor: { value: new THREE.Vector3(...SKY_HOR_D) },
    uSunCol: { value: new THREE.Vector3(...SUN_DISC) },
    uSunSize: { value: 700 }, uCloud: { value: 0.22 },
    uStorm: { value: 0 }, uFlash: { value: 0 },
    uMirrorK: { value: 1 }, uNearK: { value: 1 }, uFoamThr: { value: 0.34 },
    uBright: { value: 1 }, uFade: { value: 1 }
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: u, fog: true, side: THREE.DoubleSide,
    vertexShader: `#include <fog_pars_vertex>
      ${GLSL_WAVE_V}
      uniform float uTime, uStorm; uniform vec3 uCam;
      varying vec3 vW;
      void main(){
        vec3 p = position;
        float dist = length( position.xz );         // polar disc: the local radius IS r
        p.x += uCam.x; p.z += uCam.z;               // the surface follows the diver
        p.y += ${f(SURFACE_Y)} + waveH( p.xz, uTime, uStorm, dist );
        vW = p;
        vec4 mvPosition = viewMatrix * vec4( p, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `#include <fog_pars_fragment>
      ${GLSL_NOISE}
      ${GLSL_WAVE_F}
      uniform float uTime, uBright, uFade, uStorm, uCloud, uSunSize, uMirrorK, uNearK,
                    uFoamThr, uFlash;
      uniform vec3 uCam, uSunDir, uSkyZen, uSkyHor, uSunCol;
      varying vec3 vW;

      const float ETA = 1.333;
      const float F0  = 0.020383;   // ((n-1)/(n+1))^2 at n = 1.333; theta_c = 48.59 deg

      // The sky, on the AIR side of the interface. The entire upper hemisphere is
      // squeezed into the 97-degree window, so the horizon lands on the window rim and
      // the zenith at its centre; sqrt() biases the gradient toward the horizon, which
      // is where that compression puts most of the sky.
      vec3 skyRadiance( vec3 d ){
        float up = clamp( d.y, 0.0, 1.0 );
        vec3 c = mix( uSkyHor, uSkyZen, sqrt( up ) );
        // Cloud deck, projected onto a plane overhead so it parallaxes with the
        // refracted ray: the waves slide the sky about instead of scrolling a texture
        // stuck to the water. Faded out toward the horizon, where the projection's
        // derivative blows up and would alias into the rim.
        float cl = fbm2( ( d.xz / max( up, 0.12 ) ) * 0.35
                         + vec2( uTime * 0.012, uTime * 0.009 ) );
        c *= 1.0 - uCloud * smoothstep( 0.02, 0.30, up ) * ( 0.55 - 0.85 * cl );
        float sd = max( 0.0, dot( d, uSunDir ) );
        c += uSunCol * ( pow( sd, uSunSize ) + 0.055 * pow( sd, 14.0 ) );
        return c;
      }

      // What is actually above a total-internal-reflection ray in THIS world: the water
      // column below, which darkens with depth. That gradient is the horizon in the
      // mirror — dark where R is steep (just outside the window rim, R.y = -0.661) and
      // bright where R is shallow (toward the true horizon, R.y -> 0).
      // The seabed is NOT in it and must not be faked in: measured, zone 0's floor is
      // y = -240 to -317, so the shortest reflected path to it is 360+ units, where
      // green transmittance is 0.016 — under 0.1% of the inscatter, not worth an ALU.
      vec3 mirrorRadiance( vec3 P, vec3 R, float t, float mk ){
        float Ry = min( R.y, -0.012 );
        // Extinction-weighted mean sample height, the same closed form fog_fragment
        // uses, so the mirror is made of exactly the water the diver is swimming in.
        float ea = clamp( fogDensity * ${f(K_EXT[1])} * 300.0, 1e-4, 30.0 );
        float wgt = ea < 0.6 ? 0.5 - ea * 0.0833333 + ea * ea * ea * 0.0013889
                             : 1.0 / ea - 1.0 / ( exp( ea ) - 1.0 );
        vec3 tr = exp( -fogDensity * ${v3(K_EXT)} * 300.0 );
        vec3 c = abyssaAmbient( fogColor, P.y + Ry * 300.0 * wgt ) * ( 1.0 - tr );
        // Caustics: sunlight refracting through the wavy interface focuses into a sheet
        // a few metres down, and it is the only thing with real contrast that a
        // down-going ray can find at these depths. Sample the sheet where R actually
        // CROSSES it — the crossing point sweeps ~10 units across the visible arc of the
        // mirror, so the pattern shears and parallaxes with the view and with every wave
        // that tilts the normal, which is what separates a reflection from a texture.
        // Multiplicative, because a caustic modulates the light already there; that also
        // preserves the R.y depth gradient underneath it. Cell scale 0.30 = 3.4-unit
        // cells: any coarser and the visible arc of the mirror holds barely one blob and
        // reads flat, which is exactly the failure this whole pass exists to remove.
        float sh = fbm2( ( P.xz + R.xz * min( 16.0 / -Ry, 200.0 ) ) * 0.30
                         + vec2( t * 0.09, -t * 0.07 ) );
        // 0.45/1.65 is a 2.1x swing about unity — real caustic contrast is that strong,
        // and anything weaker sank back into "constant colour times noise" on screen.
        return c * ( 1.0 - mk * ( 0.45 - 1.65 * sh * sh ) );
      }

      // One expanding ring dimple per cell per beat. Rain read from below is a normal
      // perturbation first (a brief lens in the window) and a brightness second, which
      // is why it has to ride the displaced interface. Radius is capped under half a
      // cell so a ring never crosses into its neighbour and we never pay a 3x3 lookup.
      float rainRing( vec2 p, float t, float sd, out vec2 grad ){
        vec2 c = floor( p ), fp = fract( p ) - 0.5;
        float ph = fract( t * 0.85 + h21( c + sd ) );
        float d = max( length( fp ), 1e-3 );
        float w = d - ph * 0.44;
        float e = exp( -w * w * 300.0 ) * ( 1.0 - ph ) * ( 1.0 - ph );
        grad = ( fp / d ) * ( e * -600.0 * w );
        return e;
      }

      void main(){
        vec3 V = normalize( vW - uCam );
        float dist = distance( vW.xz, uCam.xz );
        vec2 dh = waveHN( vW.xz, uTime, uStorm, dist ).yz;

        float rain = 0.0;
        if ( uStorm > 0.02 ) {                       // uniform branch, fully coherent
          // Cells of 0.45 and 0.22 units (1.4 m and 0.7 m), so a ring reads as a drop
          // strike and not as a porthole; and only inside 26 units, because past that a
          // ring is under a pixel and all it can do is alias.
          float rk = uStorm * uNearK * ( 1.0 - smoothstep( 6.0, 26.0, dist ) );
          vec2 g1, g2;
          float r1 = rainRing( vW.xz * 2.2, uTime, 0.0, g1 );
          float r2 = rainRing( vW.xz * 4.5, uTime * 1.27, 11.0, g2 );
          dh += ( g1 * 0.0022 + g2 * 0.0011 ) * rk;
          rain = ( r1 + 0.6 * r2 ) * rk;
        }

        vec3 N = normalize( vec3( -dh.x, 1.0, -dh.y ) );
        // The camera really does cross the interface — player.js clamps the swim ceiling
        // to y = -1.2 and game.js adds up to +2.4 of camera lift, so at the raft this
        // plane is above the eye. Flipping the normal is what the old abs(dot(V,N)) was
        // standing in for; doing it properly also lets the from-above case be right.
        bool below = dot( V, N ) > 0.0;
        vec3 Nf = below ? N : -N;
        float ct = dot( V, Nf ), F;
        // Caustic detail dies with distance as well as depth: past ~120 units a 3.4-unit
        // cell is under 4 pixels and the pattern would alias into a crawl.
        float mk = uMirrorK * ( 1.0 - smoothstep( 35.0, 120.0, dist ) );
        // Each side owns an fbm2. Gating them on F keeps the common fragment paying for
        // one, not two: inside the window F is 0.02 so the mirror is invisible, outside it
        // F is 1.0 so the sky is. The branches are spatially coherent (whole window vs
        // whole mirror) and only diverge in the few degrees of the Fresnel rim.
        vec3 col = vec3( 0.0 );
        if ( below ) {
          float kk = 1.0 - ETA * ETA * ( 1.0 - ct * ct );
          float ca = sqrt( max( kk, 0.0 ) );          // cosine on the AIR side
          // Schlick on the air-side cosine: 0.020 at the zenith, 0.061 at 30 deg, 0.25
          // at 44, exactly 1.0 at the critical angle. The reflection therefore takes
          // over continuously across the last ~10 degrees and brightens itself in
          // proportion to what is in the mirror — a horizon, where the 1.7-degree
          // smoothstep plus 2.8-degree Gaussian this replaces gave a glowing wire.
          F = kk <= 0.0 ? 1.0 : F0 + ( 1.0 - F0 ) * pow( 1.0 - ca, 5.0 );
          // refract() returns exactly vec3(0) past the critical angle. F is 1.0 there so
          // the sky term is multiplied out; skyRadiance(vec3(0)) is still well defined
          // (pow(0.0, k) is 0.0 for k > 0 in GLSL), so no guard branch is needed.
          // mf ramps the mirror in rather than switching it, so the gate cannot leave a
          // step ring 8 degrees inside the rim; at F = 0.09 the term it drops is 0.01.
          float mf = smoothstep( 0.030, 0.090, F );
          if ( F < 0.998 ) col  = skyRadiance( refract( V, -Nf, ETA ) ) * ( 1.0 - F );
          if ( mf > 0.0 )  col += mirrorRadiance( vW, reflect( V, Nf ), uTime, mk ) * ( F * mf );
        } else {
          // Above the interface: air -> water, no TIR, and the roles swap.
          F = F0 + ( 1.0 - F0 ) * pow( 1.0 - ct, 5.0 );
          col = mirrorRadiance( vW, refract( V, -Nf, 1.0 / ETA ), uTime, mk ) * ( 1.0 - F )
              + skyRadiance( reflect( V, Nf ) ) * F;
        }

        // Foam from below is a bubble raft, not a highlight: it scatters isotropically,
        // so it is lit by the surface irradiance and replaces BOTH the window and the
        // mirror with the same dull grey-white. Hence a mix AFTER the Fresnel composite.
        // Deriving it from |grad h| means only the storm spectrum can ever steepen enough
        // to break. Monte-Carlo over the spectrum (20k samples): calm p99 = 0.078 and
        // max 0.095, so a 0.30 calm threshold can never fire; storm p50 = 0.102,
        // p90 = 0.189, max 0.306, so a 0.145 storm threshold covers ~22% of the ceiling.
        // 4.6x the irradiance level puts a full-storm whitecap at ~0.33 scene-linear:
        // just over BloomEffect's 0.28, so foam is the one thing on a storm ceiling that
        // glows, and it goes dark on its own at night without a second uniform.
        vec3 foamCol = vec3( 0.86, 0.94, 1.00 ) * dot( fogColor, vec3( 0.36, 0.50, 0.34 ) ) * 4.6;
        float foam = smoothstep( uFoamThr, uFoamThr + 0.05, length( dh ) )
                   * ( 0.20 + 0.80 * uStorm )
                   * ( 0.45 + 0.75 * vn( vW.xz * 0.55 + vec2( uTime * 0.12 ) ) );
        col = mix( col, foamCol, clamp( foam, 0.0, 0.85 ) * uNearK );
        col += foamCol * rain * 0.25;   // the LENS is the effect; the fleck is a garnish
        col += vec3( 0.72, 0.80, 0.92 ) * uFlash * 0.30 * uNearK;

        // uFade retires the surface as the diver descends. Without it the depth fog
        // drives this plane to near-black while the dome behind stays lit, and the
        // horizon reads as a hard black rectangle whenever you look up.
        gl_FragColor = vec4( col * uBright, uFade );
        #include <fog_fragment>
      }`
  });
  mat.transparent = true;
  mat.depthWrite = false;
  surface = new THREE.Mesh(buildSurfaceGeo(), mat);
  surface.renderOrder = -1;          // behind everything; it is a ceiling, not an occluder
  surface.frustumCulled = false;
  surface.onBeforeRender = (r, s, cam) => uCam.value.copy(cam.position);
  scene.add(surface);
}

// ---------------------------------------------------------------------------
// Bubble vents: GPU streams with wobble, growth and acceleration on the rise.
// ---------------------------------------------------------------------------
function buildBubbles() {
  const vents = [];
  for (let zi = 0; zi < 3; zi++) for (const p of scatter(5, zi, 20, WORLD_R * 0.7)) vents.push(p);
  bubbles.data = vents;

  const N = 1100, g = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), par = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const v = vents[i % vents.length];
    pos[i * 3] = v.x + rng(-0.9, 0.9); pos[i * 3 + 1] = v.y + 0.6; pos[i * 3 + 2] = v.z + rng(-0.9, 0.9);
    par[i * 4] = Math.random();        // phase
    par[i * 4 + 1] = rng(0.30, 0.85);  // rise rate
    par[i * 4 + 2] = rng(0.030, 0.115);// radius
    par[i * 4 + 3] = rng(0, 6.283);    // wobble seed
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aParam', new THREE.BufferAttribute(par, 4));

  const u = { uTime, uExtG, uPix: { value: 900 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime, uPix, uExtG;
      attribute vec4 aParam;
      varying float vA;
      void main(){
        float k = fract( aParam.x + uTime * aParam.y * 0.11 );   // 0..1 along the plume
        float h = k * k * 0.55 + k * 0.45;                       // gas accelerates as pressure drops
        vec3 p = position;
        p.y += h * 42.0;
        float wob = 0.6 + h * 2.6;                               // and wobbles harder as it grows
        p.x += sin( uTime * 3.1 + aParam.w + h * 9.0 ) * wob;
        p.z += cos( uTime * 2.6 + aParam.w * 1.7 + h * 7.0 ) * wob;
        vec4 mv = viewMatrix * vec4( p, 1.0 );
        float dist = -mv.z;
        gl_PointSize = clamp( aParam.z * ( 0.55 + h * 1.1 ) * uPix / max( dist, 0.4 ), 1.0, 40.0 );
        vA = smoothstep( 0.0, 0.06, k ) * ( 1.0 - smoothstep( 0.80, 1.0, k ) )
           * exp( -dist * uExtG * 0.9 ) * smoothstep( 0.4, 2.0, dist );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA;
      void main(){
        vec2 q = ( gl_PointCoord - 0.5 ) * 2.0;
        float d = length( q );
        if ( d > 1.0 ) discard;
        float rim = smoothstep( 0.50, 0.97, d ) * ( 1.0 - smoothstep( 0.97, 1.0, d ) );
        float spec = pow( max( 0.0, 1.0 - length( q - vec2( -0.34, 0.34 ) ) * 2.2 ), 3.0 );
        gl_FragColor = vec4( vec3( 0.70, 0.90, 1.0 ), ( rim * 0.42 + spec * 0.75 ) * vA );
      }`
  });
  bubbles.pts = new THREE.Points(g, mat);
  bubbles.pts.frustumCulled = false;
  bubbles.pts.renderOrder = 6;
  bubbles.pts.onBeforeRender = (r, s, cam) => { u.uPix.value = pixScale(r, cam); };
  scene.add(bubbles.pts);
}

// ---------------------------------------------------------------------------
export function buildWater() {
  buildDome();
  buildSurface();
  buildRays();
  snow = new THREE.Group();
  // near grit gives the parallax that sells "I am inside a medium"
  snow.add(snowLayer(2400, 30, 0.020, 0.36, 0.55, [0.55, 0.75, 0.85], [0.80, 0.86, 0.78]));
  // far snow: bigger, slower, with a few large detritus flakes from the size^2 bias.
  // Box 170 -> 300 (fade band 150..96 instead of 85..54) and 3200 -> 4200 points to
  // hold the same density in the larger volume. At 250 units in the zone-0 clear band
  // it still reads 30% transmittance — real mid-field grit, where today there is
  // nothing at all between 85 and 205 units.
  snow.add(snowLayer(4200, 300, 0.075, 0.30, 0.35, [0.50, 0.70, 0.85], [0.86, 0.80, 0.62], 0.45));
  scene.add(snow);
  buildBubbles();
  // Prime fog / background before the title screen renders. game.js only calls
  // updateAtmosphere in the play and won branches, so this ONE call is what the entire
  // title screen renders with — the camera is still at the origin at boot, so camY has
  // to be passed explicitly or the title primes from y=0 rather than from where the
  // portrait shot actually sits. -27 is that height (depth01 0.03 x 900).
  // This does NOT reproduce the old title density and cannot: the old flat model
  // THICKENED with depth from 0.0078, while the stratified clear column THINS (RC_K>0,
  // y<0 — deep water really is clearer than surface water). Matching 0.008415 would
  // need y=+109, above the waterline. The title is ~10% clearer than it was, which is
  // the same opening the descent sweep already accepts at y=-20 (ratio 1.074).
  updateAtmosphere(0.03, -27);
}

export function updateWater(dt, t) {
  uTime.value = t;
  const y = camera.position.y, d01 = clamp(-y / 900, 0, 1);

  // shafts only exist while sunlight does; when the raymarched volumetric pass is
  // active the billboards drop to accents over its broad columns (rayDim, game.js)
  // 3.66 puts the fade at exactly zero at y = -245.9, which is zone 0's silt datum:
  // shafts do not exist inside the nepheloid layer, and they fade IN as Sal climbs out
  // of it (0.244 at the zone-0 clear band, 0.39 at -150, 0.59 at -100). The identical
  // constant lives in postfx.volumetrics.js MARCH_FRAG — if the two ever disagree the
  // billboards are visible where the raymarched columns are not, which reads as a bug.
  // ...but the curve above is monotonically DECREASING from the surface, so it put the
  // shafts at FULL strength at y = 0 — which is exactly where the game starts. Measured:
  // the volumetric pass tripled total frame luminance (140 vs 40) in the opening dive,
  // a blown-out cyan wash. Physically it is backwards too: right under the surface you
  // are inside the light, not looking at shafts; a shaft needs depth to form and darker
  // water behind it to read against. So ramp them IN over the top 50 units. Only the
  // top 50 change — at -100 and below this is byte-identical to before.
  //   y=-10 0.10 (was 0.96) · y=-25 0.45 · y=-50 0.80 · y=-100 0.59 · y=-246 0.00
  const rayBand = Math.max(0, 1 - d01 * 3.66) * ms(d01, 0, 0.055);
  uRayFade.value = 0.62 * rayDim * rayBand * (0.82 + 0.18 * Math.sin(t * 0.23));
  rayMesh.visible = uRayFade.value > 0.004;
  // The surface survives to y = -330 instead of being culled at -150. In stratified
  // water the ceiling is the invitation: from the zone-0 floor the column overhead now
  // passes 14.6% blue (3.8% under the old flat model), so there is something up there
  // worth climbing to and it has to still be drawn.
  const sFade = clamp(1 - (-y - 60) / 270, 0, 1);
  surface.visible = sFade > 0.004;
  if (surface.visible) {
    const su = surface.material.uniforms;
    if (su.uFade) su.uFade.value = sFade;   // tolerate a shader built without it
    su.uBright.value = clamp(1 - d01 * 0.6, 0.45, 1) * (0.35 + 0.65 * sFade);

    // Weather reaches the sky in the window. Storms dim it AND grey it out (an overcast
    // sky is grey), thicken the cloud deck and soften the disc, which is what makes a
    // storm ceiling read as overcast rather than as dimmed sunshine.
    const storm = clamp(wMurk, 0, 1), gain = 1 - 0.62 * storm, desat = 0.5 * storm;
    mixSky(su.uSkyZen.value, SKY_ZEN_N, SKY_ZEN_D, wDay, gain, desat);
    mixSky(su.uSkyHor.value, SKY_HOR_N, SKY_HOR_D, wDay, gain, desat);
    // Sun disc crossfades to a moon through the twilight band. uSunDir does not move —
    // this world has one fixed sun azimuth; only what sits in that direction changes.
    const dk = ms(wDay, 0.05, 0.25), sk = 1 - 0.85 * storm;
    su.uSunCol.value.set(
      ml(MOON_DISC[0], SUN_DISC[0] * wDay, dk) * sk,
      ml(MOON_DISC[1], SUN_DISC[1] * wDay, dk) * sk,
      ml(MOON_DISC[2], SUN_DISC[2] * wDay, dk) * sk
    );
    su.uSunSize.value = 700 - 560 * storm;
    su.uCloud.value = 0.22 + 0.70 * storm;
    su.uStorm.value = storm;
    su.uFlash.value = wFlash;
    su.uFoamThr.value = ml(0.30, 0.145, storm);
    // The caustic sheet in the mirror and the foam/rain/flash detail are near-surface
    // phenomena; retire them well before uFade does, so the deep pays nothing for them.
    su.uMirrorK.value = clamp(1 + y / 70, 0, 1);
    su.uNearK.value = clamp(1 + y / 90, 0, 1);
  }

  // Particulate density follows the SILT, not the depth. This is the strongest local
  // confirmation of a global effect the game can give: the grit visibly thins around
  // Sal as he rises out of the layer, and thickens as he settles back into it. On the
  // floors it lands where the depth-driven version used to (z0 0.91 vs 0.88, z2 1.33
  // vs 1.40), so standing on the bottom is unchanged.
  const mf = murkFrac(y);
  snowLayers[0].uDepth.value = 0.42 + 0.95 * mf;
  snowLayers[1].uDepth.value = 0.36 + 1.10 * mf;

  // the lantern rides roughly where the camera looks, ~8.5 units ahead
  camera.getWorldDirection(_tmp);
  uLightPos.value.copy(camera.position).addScaledVector(_tmp, 8.5);

  dome.material.uniforms.uSurf.value.set(SURF_LIGHT[0] * wSurfK, SURF_LIGHT[1] * wSurfK, SURF_LIGHT[2] * wSurfK);
  dome.material.uniforms.uReach.value = 1 / uExtG.value;
  dome.material.uniforms.uSunGlow.value.set(
    0.018 * Math.max(0, 1 - d01 * 3.4),
    0.050 * Math.max(0, 1 - d01 * 3.0),
    0.080 * Math.max(0, 1 - d01 * 2.6)
  );
}

// Depth-driven water optics. depth01 = 0 at the surface, 1 at the deepest zone; it
// now only carries the WEATHER falloff, because the column itself is a function of
// height. camY defaults to the live camera so water.js's own boot call still works.
// scene.fog.color is the *surface irradiance*; the shader applies the vertical
// absorption ramp per fragment, so a frame can be teal above and ink below.
export function updateAtmosphere(depth01, camY = camera.position.y) {
  scene.fog.color.setRGB(SURF_LIGHT[0] * wSurfK, SURF_LIGHT[1] * wSurfK, SURF_LIGHT[2] * wSurfK, THREE.LinearSRGBColorSpace);
  // Storms stir the top of the column: extra murk that fades out with depth. It is a
  // scalar GAIN on the whole profile — the shader divides it back out at the eye to
  // recover it, so weather still thickens the water. What a gale CANNOT do is raise
  // the silt ceiling; that needs a scale-height uniform and there is no free one.
  const storm = 1 + wMurk * 0.55 * Math.max(0, 1 - depth01 * 2.4);
  // The TRUE LOCAL total density at the eye. Four downstream consumers read this every
  // frame (creatures/predators/tools uFogD, volumetrics uDens) and its meaning is
  // deliberately unchanged: within 1% of the old flat model at every floor, so no
  // additive glow changes range and nothing turns neon.
  scene.fog.density = waterRho(camY) * storm;
  uExtG.value = waterExtG(camY) * storm;
  // Keyed to the CAMERA, not to -depth01*900. That incidentally settles the long-
  // standing player-depth vs camera-depth disagreement (CAM_UP 2.4 / CAM_BACK 9 on a
  // lagging spring), and it is what makes the background match the fog's asymptote.
  scene.background = ambientAt(camY, _outCol);
  return _outCol;
}

export { clamp };
