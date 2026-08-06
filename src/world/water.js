// Ocean surface (Snell's window), volumetric god rays, particulates, bubble vents,
// and the depth-absorption atmosphere model.
// OWNED BY: water/atmosphere agent.
import * as THREE from 'three';
import { scene, camera, renderer } from '../core.js';
import { WORLD_R, SURFACE_Y, SUN, GLASS, SKY } from '../config.js';
// Re-exported so the coming lab (and the brief's contract) can reach the tuning surface
// from here. It is DEFINED in config.js — weather.js needs GLASS.sun and this file needs
// GLASS.stops, and config.js is the only module both already import. Plain mutable data:
// poke it live and the next frame picks it up.
export { GLASS } from '../config.js';
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
// THE SUN IS LIVE NOW. There is no module-level SUN_DIR or SUN_PROJ any more: those
// were baked once at import and would have frozen the sky mid-morning the moment the
// day cycle started moving it. Everything here reads config.js's SUN each frame through
// uniforms — uSunDirU from SUN.dir (the in-air sun, for the disc and the glitter path)
// and uSunProj from SUN.proj (the UNDERWATER sun, elevation clamped at Snell's 41.4,
// for the god-ray shaft descent). The shaft offset in particular used to be a string
// constant compiled into the shader; converting it to a uniform is what lets the shafts
// swing with the day without recompiling a single program.

// Sky radiance seen through the interface, night -> day. These are raw scene-linear
// values: verified live that NOTHING in this pipeline tone-maps (0 of 121 compiled
// programs contain ACESFilmicToneMapping — three only injects it when rendering to the
// canvas, and the composer renders to targets), so what a material writes is what
// BloomEffect thresholds at 0.28. The window interior is deliberately kept just under
// that; only the sun disc, its aureole and the compressed horizon ring cross it.
// Horizon 4.3x the zenith: the whole point is that the window has an IMAGE in it, and
// the horizon ring is the only structural landmark the sky offers. Measured through the
// full Fresnel composite that lands as a 0.35 ring against a 0.15 centre.
// These now live in config.js's GLASS.stops so the lab can poke them; the aliases stay
// because every note in this file refers to them by name. `_D` = the noon stop, `_N` =
// the night stop, and those two stops carry the exact values that shipped, so the old
// two-point night/day lerp is a strict subset of the new five-stop ring.
const SKY_ZEN_D = GLASS.stops.noon.zen, SKY_HOR_D = GLASS.stops.noon.hor;
// Night is not the true ~1e-5: game.js floors the surface irradiance at 0.20 of noon so
// the world stays legible, and the sky has to sit consistently below the water that sky
// is supposed to be lighting, or the window inverts into a bright lid again.
// (The old SKY_*_N night pair and MOON_DISC are gone as named constants — they are the
// `night` stop in GLASS.stops now, reached by the ring rather than by a lerp parameter.)
const SUN_DISC = GLASS.stops.noon.disc;

// ---------------------------------------------------------------------------
// AIR — the other half of the medium.
// ---------------------------------------------------------------------------
// Until the surface round the Beer-Lambert extinction above ran on EVERY fragment
// regardless of height, so the air was rendered as water: from the raft the upper frame
// was the underwater dome and the sea was a milky see-through band. Air gets its own,
// far thinner haze, and any ray that crosses y = 0 is integrated piecewise.
//
// 0.0040/unit in green is a marine haze: one unit is 3 m, so meteorological visibility
// (2% transmittance) lands at 978 units = 2.9 km. That is a grey working sea, not a
// tropical postcard, and it is also what closes the seam at the ocean disc's 460-unit
// rim: transmittance there is 0.159 green, so the last of the difference between the
// sea and the dome behind it is under 4 sRGB code values.
// Faintly blue-tilted (aerosol, not Rayleigh — a real marine haze is nearly grey).
const K_AIR = [0.00380, 0.00400, 0.00440];

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

// The AIR half of the medium. Shared VERBATIM by the fog chunk, the dome and the ocean
// surface for exactly the reason GLSL_WATER is: the fog chunk's L -> infinity limit, the
// dome below the horizon and the far edge of the ocean disc are three different pieces of
// geometry that have to agree on one number, and the only way to guarantee that is to
// have them evaluate the same function.
const GLSL_AIR = `
#define KAIR ${v3(K_AIR)}

// Airlight: what a long path through air settles on. It IS the sky at the horizon, which
// is what makes those three pieces land on one colour with nothing to step against.
//
// The fog chunk can only see fogColor and fogDensity. three clones UniformsLib.fog into
// every ShaderLib entry at ITS module-eval, so mutating UniformsLib.fog afterwards is a
// no-op for built-in materials and would leave an undeclared uniform in the chunk -- the
// program fails to link and there is no fog at all. So day is recovered here by inverting
// game.js's surfK, exactly the way setWeatherWater already does it one file up.
// Storm is NOT separable from that one scalar: at full gale this reads ~13% brighter and
// less desaturated than the sky it meets. skyDome eases the last 3.4 degrees of sky into
// this same value, so the residual is a soft gradient at the horizon and never a step.
// THE ONE SURVIVING BAKE. SKY_HOR_D is compiled in here as a literal and does NOT follow
// the palette ring, for the reason in the paragraph above: this lives in the globally
// patched fog chunk, which cannot be given a uniform of its own. It is the NOON horizon,
// so it is right where it matters most and drifts warm-ward at dawn/dusk against a sky
// that has moved. Visible only as a slight cool cast in the last few degrees above the
// horizon in air, at the two times of day the horizon is most interesting — flagged for
// the lab to judge rather than silently "fixed" here, since fixing it means re-patching
// the fog chunk for every material in the game.
vec3 airLight( vec3 surfIrr ){
  float dg = clamp( ( surfIrr.g / ${f(SURF_LIGHT[1])} - 0.20 ) / 0.80, 0.0, 1.0 );
  return ${v3(SKY_HOR_D)} * ( 0.0266 + 0.9734 * dg );
}`;

// THE SKY. One function, used by the ocean surface on BOTH sides of the interface and by
// the background dome, so the sky seen from the air and the sky compressed into Snell's
// window from below are literally the same image. The body is unchanged from the
// window-only version it grew out of — that is what keeps the underwater view identical,
// and it is also the whole point: consistency between the two views.
// Requires GLSL_NOISE (fbm2) and the uSky*/uSun*/uCloud/uTime uniforms.
const GLSL_SKY = `
vec3 skyRadiance( vec3 d ){
  float up = clamp( d.y, 0.0, 1.0 );
  vec3 c = mix( uSkyHor, uSkyZen, sqrt( up ) );
  // Cloud deck, projected onto a plane overhead so it parallaxes with the ray: from
  // below the waves slide the sky about instead of scrolling a texture stuck to the
  // water; from above it is the overcast itself. Faded out toward the horizon, where the
  // projection's derivative blows up and would alias into the rim.
  float cl = fbm2( ( d.xz / max( up, 0.12 ) ) * 0.35
                   + vec2( uTime * 0.012, uTime * 0.009 ) );
  c *= 1.0 - uCloud * smoothstep( 0.02, 0.30, up ) * ( 0.55 - 0.85 * cl );
  float sd = max( 0.0, dot( d, uSunDir ) );
  c += uSunCol * ( pow( sd, uSunSize ) + 0.055 * pow( sd, 14.0 ) );
  return c;
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
// weather.js's single envelope. Until game.js wires it, BOTH default to raw murk, which
// is bit-for-bit what shipped. sky drives the palette and the sky material; sea drives
// the interface's own churn.
let wEnvSky = 0, wEnvSea = 0, envWired = false;
export function setWeatherEnv(env) {
  if (!env) { envWired = false; wEnvSky = wEnvSea = wMurk; return; }
  envWired = true;
  wEnvSky = env.sky; wEnvSea = env.sea;
}
export function setWeatherWater(surfK, murk, day, flash) {
  wSurfK = surfK; wMurk = murk;
  if (!envWired) { wEnvSky = murk; wEnvSea = murk; }
  wDay = day !== undefined ? day
    : clamp((surfK / Math.max(0.35, 1 - 0.45 * murk) - 0.20) / 0.80, 0, 1);
  wFlash = flash || 0;
  // The palette is resolved ONCE per frame, here: game.js calls this straight after
  // updateWeather and before both updateWater and updateAtmosphere, which are the two
  // consumers. Doing it in either of those would make the sky and the fog disagree on
  // the frames only one of them runs.
  palette(SKY.ring, wEnvSky);
}
export function setRayDim(k) { rayDim = k; }

// CPU mirror of abyssaAmbient, for scene.background and the returned tint.
const ms = THREE.MathUtils.smoothstep, ml = THREE.MathUtils.lerp;
// ---------------------------------------------------------------------------
// THE PALETTE RING. Five authored stops (config.js GLASS.stops) replacing the old
// two-point night/day lerp. Position on night->dawn->noon->dusk->night comes from
// weather.js as SKY.ring (0..4, wrapping); the whole result is then cross-faded toward
// the STORM stop by the storm envelope.
//
// The old form was `mixSky(v, N, D, day, gain, desat)` — a straight lerp between the
// night and day pairs, then a scalar gain and a desaturation for storms. Both endpoints
// of that lerp survive VERBATIM as the `night` and `noon` stops, so this is a strict
// generalisation: ring 0 reproduces the old day = 0 and ring 2 the old day = 1 exactly.
// The storm cross-fade is authored to land where the old gain/desat pair landed at noon,
// then pushed off the blue axis (see the stop's note).
//
// Every value below is written into module-scope arrays and then into existing uniform
// objects. NOTHING here allocates, and nothing here can recompile a program: the stops
// are data, not shader source.
const _ring = [null, null, null, null];
const _pZen = [0, 0, 0], _pHor = [0, 0, 0], _pDisc = [0, 0, 0];
const _pSurf = [0, 0, 0];               // SURF_LIGHT * wSurfK * stop.surfK * stop.tint
let _pDesat = 0;

function lerp3(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}
function toward3(out, b, t) {
  out[0] += (b[0] - out[0]) * t;
  out[1] += (b[1] - out[1]) * t;
  out[2] += (b[2] - out[2]) * t;
}
// Pull toward the array's own luminance. Same Rec.709 weights the old mixSky used.
function desat3(v, k) {
  if (k <= 0) return;
  const l = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  v[0] = ml(v[0], l, k); v[1] = ml(v[1], l, k); v[2] = ml(v[2], l, k);
}

function palette(ring, envSky) {
  const S = GLASS.stops;
  _ring[0] = S.night; _ring[1] = S.dawn; _ring[2] = S.noon; _ring[3] = S.dusk;
  let r = ring >= 0 && ring < 4 ? ring : 2;
  const i = Math.floor(r), t = r - i;
  const a = _ring[i], b = _ring[(i + 1) & 3];
  lerp3(_pZen, a.zen, b.zen, t);
  lerp3(_pHor, a.hor, b.hor, t);
  lerp3(_pDisc, a.disc, b.disc, t);
  lerp3(_pSurf, a.tint, b.tint, t);
  let sk = a.surfK + (b.surfK - a.surfK) * t;
  _pDesat = a.desat + (b.desat - a.desat) * t;

  const s = clamp(envSky, 0, 1);
  if (s > 0) {
    const T = S.storm;
    toward3(_pZen, T.zen, s);
    toward3(_pHor, T.hor, s);
    toward3(_pDisc, T.disc, s);
    toward3(_pSurf, T.tint, s);
    sk += (T.surfK - sk) * s;
    _pDesat += (T.desat - _pDesat) * s;
  }
  desat3(_pZen, _pDesat);
  desat3(_pHor, _pDesat);

  // The surface irradiance. game.js's own day/storm surfK still multiplies in front —
  // the stop only adds the TINT and a stop-local scale, and at noon both are identity,
  // which is what keeps scene.fog.color bit-identical to today.
  const g = wSurfK * sk;
  _pSurf[0] *= SURF_LIGHT[0] * g;
  _pSurf[1] *= SURF_LIGHT[1] * g;
  _pSurf[2] *= SURF_LIGHT[2] * g;
}
palette(2, 0);
function ambientAt(y, out) {
  const t = clamp(-y / 900, 0, 1);
  const a = ms(t, 0.20, 0.52), b = ms(t, 0.62, 0.92), c = ms(t, 0.03, 0.30), d = Math.min(0, y);
  return out.setRGB(
    _pSurf[0] * Math.exp(K_ABS[0] * d) + ml(ml(0.0020, 0.0064, a), 0.0123, b) * c,
    _pSurf[1] * Math.exp(K_ABS[1] * d) + ml(ml(0.0073, 0.0027, a), 0.0042, b) * c,
    _pSurf[2] * Math.exp(K_ABS[2] * d) + ml(ml(0.0115, 0.0127, a), 0.0025, b) * c,
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
${GLSL_AIR}
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

    // --- SPLIT THE PATH AT THE WATERLINE ------------------------------------
    // The medium is piecewise in HEIGHT exactly the way the nepheloid layer is, so the
    // same split-and-integrate applies one level up: WATER only over the submerged part
    // of the ray, thin AIR over the rest. Before this, the extinction ran on every
    // fragment regardless of height and the air above the raft was rendered as water.
    //
    // fw is the fraction of the segment lying below y = 0. For a ray with BOTH endpoints
    // submerged the quotient exceeds 1 and the clamp saturates to EXACTLY 1.0, so
    // Lw == vFogDepth, La == 0.0, yw0/yw1 collapse to the raw endpoints, and every term
    // below is bit-identical to the pre-sky shader. That is the regression guarantee for
    // the whole underwater game, and it is exact rather than approximate.
    // The |dy| guard is the horizontal ray: not a 0/0 that needs a limit, just a divide
    // that would produce inf. step() returns exactly 1.0 for an eye at or below y = 0.
    float dy  = vFogY - cameraPosition.y;
    float fw  = abs( dy ) > 1e-4
      ? clamp( -min( cameraPosition.y, vFogY ) / abs( dy ), 0.0, 1.0 )
      : step( cameraPosition.y, 0.0 );
    float Lw  = vFogDepth * fw;
    float La  = vFogDepth - Lw;
    // Endpoints of the SUBMERGED sub-segment. min(y,0) gives them for free and, crucially,
    // preserves which end is nearer the eye: eye in air -> yw0 is the crossing (near),
    // yw1 the fragment; eye in water -> yw0 is the eye, yw1 the crossing. That ordering is
    // what lets the inscatter weight below keep meaning "weighted toward the eye".
    float yw0 = min( cameraPosition.y, 0.0 );
    float yw1 = min( vFogY, 0.0 );

    float yf, hs, amp;
    nephParams( cameraPosition.y, yf, hs, amp );
    float s0 = ( yw0 - yf ) / hs;
    float s1 = ( yw1 - yf ) / hs;
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
    // e0 now comes from yw0, not from cameraPosition.y. Those are the same number for
    // every submerged eye; for an eye in the AIR they differ by amp*(e^-(y/hs) - 1) on a
    // term already down at 3.3e-5 of amp -- 2.5e-7 relative on the divisor. Recomputing it
    // at the true camera height would cost a whole extra exp() per fragment to fix the
    // seventh decimal place of a case the water is not even in.
    float storm = dens / max( rhoClearAt( cameraPosition.y ) + amp * e0, 1e-6 );

    // Clear column is linear in y, so its exact path mean is the midpoint value.
    float ic  = Lw * rhoClearAt( 0.5 * ( yw0 + yw1 ) ) * storm;
    float im  = Lw * amp * shp * storm;
    vec3  tau = ic * KMOL + im * KPART;
    vec3  tr  = exp( -tau );

    // series form below 0.6: the closed form is two large reciprocals that cancel,
    // which loses all precision in fp32 on nearby geometry
    float ea  = clamp( tau.g, 1e-4, 30.0 );
    float wgt = ea < 0.6 ? 0.5 - ea * 0.0833333 + ea * ea * ea * 0.0013889
                         : 1.0 / ea - 1.0 / ( exp( ea ) - 1.0 );
    float ay  = yw0 + ( yw1 - yw0 ) * wgt;

    vec3 J = siltTint( abyssaAmbient( fogColor, ay ), murkFracAt( ay, yf, hs, amp ) );
    vec3 c = gl_FragColor.rgb * tr + J * ( 1.0 - tr );

    // The air leg. Skipped outright when the ray never leaves the water, which is every
    // frame the game itself renders -- so the underwater path pays nothing for the sky,
    // not even the three exp() this costs, and c is left byte-identical.
    if ( La > 0.0 ) {
      vec3 trA = exp( -La * KAIR );
      vec3 A   = airLight( fogColor );
      // ORDER MATTERS: the leg nearer the EYE attenuates the far leg's inscatter, and
      // which leg that is flips with the eye. Both forms below are the exact three-term
      // composite (frag*trW*trA + near-J + far-J*tr_near), algebraically folded so the
      // pure-water result c can be reused instead of recomputed.
      //   eye in air  : L = trA*c + A*(1-trA)
      //   eye in water: L = c + trW*(1-trA)*(A - frag)
      c = cameraPosition.y < 0.0
        ? c + tr * ( 1.0 - trA ) * ( A - gl_FragColor.rgb )
        : mix( A, c, trA );
    }
    gl_FragColor.rgb = c;
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
// Sky state, SHARED by the ocean surface and the background dome. One set of uniform
// objects, written once per frame in updateWater: the two materials cannot disagree about
// what the sky is doing, which is the whole reason the sky seen from the air and the sky
// in Snell's window are the same sky.
const uSkyZen = { value: new THREE.Vector3(...SKY_ZEN_D) };
const uSkyHor = { value: new THREE.Vector3(...SKY_HOR_D) };
const uSunCol = { value: new THREE.Vector3(...SUN_DISC) };
// The in-air sun, rewritten from SUN.dir every updateWater.
const uSunDirU = { value: new THREE.Vector3(SUN.dir.x, SUN.dir.y, SUN.dir.z) };
// The UNDERWATER sun's horizontal descent, dirWater.xz/dirWater.y. Was a baked vec2
// literal in the god-ray vertex shader.
const uSunProj = { value: new THREE.Vector2(SUN.proj[0], SUN.proj[1]) };
const uSunSize = { value: 700 };
const uCloud = { value: 0.22 };
const uStormU = { value: 0 };
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
      uReach: { value: 46 }, uTime, uSunGlow: { value: new THREE.Vector3() },
      uSkyZen, uSkyHor, uSunCol, uSunDir: uSunDirU, uSunSize, uCloud, uAir
    },
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir;
      void main(){ vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        gl_Position = vec4( p.xy, p.w * 0.999999, p.w ); }`,
    fragmentShader: `uniform vec3 uSurf, uSunGlow; uniform float uReach, uTime;
      uniform vec3 uSkyZen, uSkyHor, uSunCol, uSunDir;
      uniform float uSunSize, uCloud, uAir;
      varying vec3 vDir;
      ${GLSL_NOISE}
      ${GLSL_AMBIENT}
      ${GLSL_WATER}
      ${GLSL_AIR}
      ${GLSL_SKY}

      // The far field on the AIR side. Below the horizon it is open sea at grazing
      // incidence — which is the reflected horizon sky closed by haze, i.e. the airlight
      // — and that is also what the fog chunk converges on at L -> infinity and what the
      // ocean disc fades into at its 460-unit rim. Three surfaces, one number, no ring.
      // Above the horizon, ease the last 3.4 degrees of sky into the same value: it costs
      // nothing in clear weather (skyRadiance already tends to uSkyHor there) and it is
      // what hides airLight's storm approximation.
      // BOTH smoothstep edges ASCEND. The inverted form is UNDEFINED in GLSL and produces
      // driver-dependent garbage — the same trap documented on nephParams.
      vec3 skyDome( vec3 d, vec3 hz ){
        return mix( skyRadiance( d ), hz, 1.0 - smoothstep( 0.0, 0.060, d.y ) );
      }

      void main(){
        vec3 d = normalize( vDir );
        // Above the waterline the background is SKY, not water. uAir is computed on the
        // CPU against the REAL local surface height under the camera (see surfaceHeightAt)
        // rather than a flat threshold — a flat one disagreed with the sea's own
        // per-fragment dot(V,N) test and made the interface strobe as waves rolled past it.
        float air = uAir;
        if ( air >= 1.0 ) {
          gl_FragColor = vec4( skyDome( d, airLight( uSurf ) ), 1.0 );
          return;
        }
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
        // The crossing band. Skipped entirely at air == 0.0, which is every frame the
        // game can produce, so the water dome below the waterline is untouched.
        if ( air > 0.0 ) c = mix( c, skyDome( d, airLight( uSurf ) ), air );
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
      uTime, uCam, uExtG, uFade: uRayFade, uSunProj,
      uColor: { value: new THREE.Vector3(0.36, 0.55, 0.68) }
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, fog: false,
    vertexShader: `uniform vec3 uCam; uniform float uFade, uExtG; uniform vec2 uSunProj;
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
        // A UNIFORM, not a baked literal: the shafts swing with the day, and because it
        // is fed from SUN.proj (dirWater, clamped at Snell's 41.4) they can never lean
        // further than refraction allows however low the sun gets.
        wp.xz -= uSunProj * ( v * aParam.y );
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
           // Marine snow is water-borne. The wrap box follows the camera, so an eye at
           // the surface used to fill the AIR with drifting grit. Exactly 1.0 for
           // w.y <= 0, so nothing below the waterline changes by a bit.
           * ( 1.0 - smoothstep( 0.0, 0.9, w.y ) )
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

// CPU mirror of the VERTEX wave pass (the first 3 components — the ones the mesh actually
// carries as geometry, so this is the height the surface really has). Evaluated at the
// camera's own xz, where the distance taper is 1 by construction (dist = 0 < fr*0.5).
//
// This exists because "is the eye in air?" was being answered THREE different ways that
// disagreed: the dome used a flat smoothstep(-0.85, 0.15, camY), the occlusion toggle
// used a hard y > 0, and the surface shader used a correct per-fragment dot(V,N) > 0.
// Measured consequences of that disagreement: the dome painted sky into the underwater
// far field as a pale band with terrain silhouetted against it; an 81-123 code-value step
// as the eye crossed, in the wrong direction (going under got BRIGHTER); and a camera
// held still at the waterline STROBED by 59% frame-mean as waves swept past the flat
// threshold. One shared answer, keyed on the real local surface, removes all three.
const _wavePhase = WAVE.slice(0, 3).map(([lam, deg, a0, a1]) => {
  const k = 2 * Math.PI / lam, a = deg * Math.PI / 180;
  return { k, w: DISP * Math.sqrt(k), dx: Math.cos(a), dz: Math.sin(a), a0, a1 };
});
export function surfaceHeightAt(x, z, t, storm) {
  const sm = THREE.MathUtils.smoothstep(storm, 0, 0.90);
  let h = 0;
  for (let i = 0; i < 3; i++) {
    const c = _wavePhase[i];
    h += (c.a0 + (c.a1 - c.a0) * sm) * Math.sin((x * c.dx + z * c.dz) * c.k + t * c.w);
  }
  return h;
}
// 0 = eye fully in water, 1 = fully in air. The band is half a helmet: narrow enough that
// the transition is a moment, wide enough not to alias on a chopping surface.
const AIR_BAND = 0.35;
const uAir = { value: 0 };
// The live surface height under the camera, refreshed once per frame in updateWater.
// game.js clamps the play camera against THIS rather than a flat SURFACE_Y, so the
// clamp sits below the air band even in a gale (a storm trough reaches about -0.6, which
// against a flat -0.9 clamp would have leaked a little sky into the underwater frame).
let _surfH = SURFACE_Y;
export function localSurfaceY() { return _surfH; }

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

// ---------------------------------------------------------------------------
// SCREEN-SPACE REFRACTION — the sea's transmission term becomes real.
// ---------------------------------------------------------------------------
// The surface shader used to INVENT what lies through the interface: an analytic water
// body from above, an analytic sky from below. That is why the sea read as an opaque
// green sheet from the deck, and why the raft's hull simply did not exist when you
// looked up at it from underneath. Each frame near the surface we now render the OTHER
// side of the interface into a half-res target — a clip plane at the local surface
// height keeps exactly the half-world the transmitted ray would see — and the shader
// samples it with a refraction offset. Reflection stays analytic; only transmission
// becomes real.
//
// The absorption comes free, and this is the reason the pass needs no depth texture:
// the Beer-Lambert fog is patched into EVERY material globally and integrates density
// along the camera->fragment path in height, so a render of the underwater world from
// an in-air camera already carries near-correct per-channel attenuation for the
// underwater leg of each ray (the air leg contributes ~nothing — rho above the surface
// is the profile's exponential tail). What lands in the target is the scene through
// the water, already dimmed and hued by exactly the water Sal swims in.
const uRefr = { value: new THREE.DataTexture(new Uint8Array([8, 24, 32, 255]), 1, 1) };
uRefr.value.needsUpdate = true;
const uRefrK = { value: 0 };            // master gate: 0 = pure analytic (old behaviour)
const uRefrSide = { value: 1 };         // 1 = target holds the UNDERWATER world (camera in air)
const uRes = { value: new THREE.Vector2(1, 1) };
let refrRT = null;
const _clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
const _clipArr = [_clipPlane];
const _rtSize = new THREE.Vector2();
const _prevClear = new THREE.Color();
let refrOn = true, refrAir = true, refrFrame = 0;

// Quality fallback ladder, driven by postfx.degradeQuality. reduceRefraction is tier 1:
// the target drops from half-res to quarter-res — ~a quarter of the pass's cost, and
// through a distorting, water-fogged interface the resolution loss barely reads.
// degradeRefraction is tier 2: the pass is gone and the analytic sea returns.
let refrShift = 1;
export function reduceRefraction() {
  refrShift = 2;
  if (refrRT) { refrRT.dispose(); refrRT = null; }   // rebuilt next frame at the new size
}
export function degradeRefraction() { refrOn = false; uRefrK.value = 0; }

// Called by game.js once per frame, after updateWater (needs _surfH/uAir) and before
// the composer render. Renders the far side of the interface into refrRT.
export function renderRefraction() {
  // Below -35 the ceiling is fog-bound arm-waving anyway, and from the air the pass is
  // pointless once the surface itself has been retired.
  const on = refrOn && !window.__noRefr && surface && surface.visible &&
    camera.position.y > -35;
  if (!on) { uRefrK.value = 0; return; }

  // TEMPORAL, because quarter-res was not the cost. The pass submits the whole scene a
  // second time, and draw-call submission is CPU work that no render-target size can
  // shrink — which is why the tier-1 shed didn't save the machine it was built for
  // (user-reported: frame rate still dropping, transparency lost immediately). Under a
  // surface that distorts every sample anyway, a target refreshed at half rate (a third
  // at tier 1) is indistinguishable, and it halves the pass's true cost. The one frame
  // that must never be skipped is a side flip: a stale target there shows the WRONG
  // WORLD through the interface for a frame.
  refrFrame++;
  const sideNow = refrAir ? (uAir.value >= 0.30) : (uAir.value > 0.70);
  if (sideNow === refrAir && refrFrame % (refrShift === 1 ? 2 : 3) !== 0) return;

  renderer.getDrawingBufferSize(_rtSize);
  uRes.value.copy(_rtSize);
  const w = Math.max(2, _rtSize.x >> 1), h = Math.max(2, _rtSize.y >> 1);
  if (!refrRT) {
    // Own depth RENDERBUFFER, never shared with the composer — this project has a
    // GL_INVALID_OPERATION history from depth-attachment sharing.
    refrRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true
    });
  } else if (refrRT.width !== w || refrRT.height !== h) refrRT.setSize(w, h);

  // Hysteresis, not a threshold. Floating at the surface the camera rides the swell
  // right through uAir = 0.5, and a hard cut there flip-flops the target between
  // worlds — each wrong-side frame renders as the old opaque sea, which is exactly the
  // report that exposed this. The side only changes once the camera is DECIDEDLY on
  // the other side of the band.
  if (refrAir && uAir.value < 0.30) refrAir = false;
  else if (!refrAir && uAir.value > 0.70) refrAir = true;
  const air = refrAir;
  uRefrSide.value = air ? 1 : 0;
  // Keep the half-world the transmitted ray enters. A 0.04 bias hides the sliver of
  // double-drawn geometry where the wavy true surface crosses the flat clip plane.
  if (air) { _clipPlane.normal.set(0, -1, 0); _clipPlane.constant = _surfH + 0.04; }
  else { _clipPlane.normal.set(0, 1, 0); _clipPlane.constant = -(_surfH - 0.04); }

  const prevRT = renderer.getRenderTarget();
  const prevShadow = renderer.shadowMap.autoUpdate;
  renderer.getClearColor(_prevClear);
  const prevAlpha = renderer.getClearAlpha();
  surface.visible = false;
  renderer.clippingPlanes = _clipArr;
  // The composer's main render refreshes the shadow maps this frame anyway; letting
  // this pass refresh them too would draw every caster twice for nothing.
  renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(refrRT);
  // autoClear is false globally (composer discipline), so clear by hand. The clear
  // colour is the far-field ambient at the camera — anywhere no geometry lands, the
  // transmitted ray reads as open water, which is what an unbounded ray would find.
  renderer.setClearColor(scene.background && scene.background.isColor ? scene.background : _prevClear, 1);
  renderer.clear(true, true, false);
  renderer.render(scene, camera);
  renderer.setRenderTarget(prevRT);
  renderer.clippingPlanes = [];
  renderer.shadowMap.autoUpdate = prevShadow;
  renderer.setClearColor(_prevClear, prevAlpha);
  surface.visible = true;

  uRefr.value = refrRT.texture;
  // Fade the whole effect out over the last 10 units of its depth range so it never
  // pops on the gate; analytic underneath is continuous.
  uRefrK.value = clamp((camera.position.y + 35) / 10, 0, 1);
}

function buildSurface() {
  // uSkyZen/uSkyHor/uSunCol/uSunDir/uSunSize/uCloud/uStorm are the module-scoped objects
  // the DOME also holds. Shared on purpose: the sky in Snell's window and the sky over
  // the horizon are the same sky, and sharing the uniform is the only way that stays true
  // without a second update path to keep in sync.
  const u = Object.assign(fogUniforms(), {
    uTime, uCam,
    uSunDir: uSunDirU, uSkyZen, uSkyHor, uSunCol, uSunSize, uCloud, uStorm: uStormU,
    uFlash: { value: 0 },
    uMirrorK: { value: 1 }, uNearK: { value: 1 }, uFoamThr: { value: 0.34 },
    uBright: { value: 1 }, uFade: { value: 1 },
    uRefr, uRefrK, uRefrSide, uRes
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
                    uFoamThr, uFlash, uRefrK, uRefrSide;
      uniform vec3 uCam, uSunDir, uSkyZen, uSkyHor, uSunCol;
      uniform sampler2D uRefr;
      uniform vec2 uRes;
      varying vec3 vW;

      // The scene through the interface, sampled from the far-side render. The offset
      // is the view-space parallax between the refracted ray and the straight one plus
      // a wobble from the wave gradient, which is what makes the transmitted world
      // shimmer with the swell instead of sitting still under it. ok fades to 0 at the
      // target's edges so the caller can ease back to the analytic answer where the
      // screen simply does not know what the ray would hit.
      vec3 refrSample( vec3 R, vec3 V, vec2 dh, out float ok ){
        vec3 Rv = normalize( ( viewMatrix * vec4( R, 0.0 ) ).xyz );
        vec3 Vv = normalize( ( viewMatrix * vec4( V, 0.0 ) ).xyz );
        // The offset is CLAMPED, hard. In a gale the wave gradient reaches ~0.5 and an
        // unbounded wobble smeared the whole transmitted scene into ghosts (measured:
        // a phantom davit leg two metres from the real one). 0.035 NDC is ~30 px at
        // 1080p — enough shimmer to say water, small enough that things stay themselves.
        vec2 off = ( Rv.xy / max( -Rv.z, 0.08 ) - Vv.xy / max( -Vv.z, 0.08 ) ) * 0.14
                 + dh * 0.05;
        float om = length( off );
        if ( om > 0.035 ) off *= 0.035 / om;
        vec2 uv = gl_FragCoord.xy / uRes + off;
        vec2 m = min( uv, 1.0 - uv );
        float inb = min( m.x, m.y );
        ok = clamp( inb * 14.0, 0.0, 1.0 ) * step( 0.0, inb );
        return texture2D( uRefr, clamp( uv, 0.002, 0.998 ) ).rgb;
      }

      const float ETA = 1.333;
      const float F0  = 0.020383;   // ((n-1)/(n+1))^2 at n = 1.333; theta_c = 48.59 deg

      // Seen from BELOW, the entire upper hemisphere is squeezed into the 97-degree
      // window, so the horizon lands on the window rim and the zenith at its centre;
      // sqrt() biases the gradient toward the horizon, which is where that compression
      // puts most of the sky. From ABOVE the identical function is evaluated on the
      // true reflected direction. Same sky, both sides — see GLSL_SKY.
      ${GLSL_SKY}

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

      // Down-looking is not up-looking. abyssaAmbient is the ISOTROPIC fully-scattered
      // field -- what a diver is INSIDE -- and it is several times what actually escapes
      // upward through the interface; real ocean irradiance reflectance is 2-6%. Left
      // raw, the sea from above measured 0.080 scene-linear green against a horizon sky
      // of 0.56 and read as a lit tropical lagoon. 0.46 is the level. The 0.35 pull
      // toward luminance is what turns a teal pool into grey North-Atlantic water
      // WITHOUT moving the hue off the game's own palette -- the same trick siltTint
      // uses, for the same reason: desaturate, do not re-tint.
      // Air side only. The from-below mirror is the diver's own medium and keeps its
      // full radiance.
      vec3 seaBody( vec3 c ){
        return mix( c, vec3( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) ), 0.35 ) * 0.46;
      }

      // Short wind chop, AIR SIDE ONLY. The six-component swell bottoms out at a
      // 19.5 m wavelength, which from an eye 1.6 units (5 m) above the water is a sheet
      // of glass — no sea state at all. Three crossed components at 3.4 / 1.7 / 0.85
      // units (10 / 5 / 2.5 m) with analytic gradients, NORMALS ONLY: the polar mesh's
      // cell is 0.085 u at r = 1.2 but 2.4 u at r = 34, so it cannot carry these as
      // geometry. Retired between 40 and 130 units for the same reason — the mesh is
      // camera-anchored and the field is world-anchored, so any aliasing would CRAWL as
      // the diver moves, which is the one artefact this sea cannot afford.
      // The vn() term is patchiness: cat's paws of ruffled water, not uniform corduroy.
      // Deliberately NOT applied to the from-below normal: that would change Snell's
      // window, the foam threshold and the TIR mirror all at once.
      vec2 rippleGrad( vec2 p, float t, float storm, float dist ){
        float fade = 1.0 - smoothstep( 50.0, 165.0, dist );
        if ( fade <= 0.002 ) return vec2( 0.0 );
        float gain = ( 0.95 + 1.15 * storm ) * fade
                   * ( 0.45 + 1.05 * vn( p * 0.055 + vec2( t * 0.021, -t * 0.017 ) ) );
        vec2 g = vec2( 0.0 );
        { float q = dot( p, vec2( 0.940, 0.342 ) ) * 1.848 + t * 2.458;
          g += vec2( 0.940, 0.342 ) * ( 0.02033 * cos( q ) ); }
        { float q = dot( p, vec2( -0.423, 0.906 ) ) * 3.696 + t * 3.477;
          g += vec2( -0.423, 0.906 ) * ( 0.02033 * cos( q ) ); }
        { float q = dot( p, vec2( 0.707, -0.707 ) ) * 7.392 + t * 4.916;
          g += vec2( 0.707, -0.707 ) * ( 0.01626 * cos( q ) ); }
        return g * gain;
      }

      void main(){
        vec3 V = normalize( vW - uCam );
        float dist = distance( vW.xz, uCam.xz );
        vec2 dh = waveHN( vW.xz, uTime, uStorm, dist ).yz;

        float rain = 0.0;
        vec2 dhRain = vec2( 0.0 );   // kept separate: the air side wants less of it
        if ( uStorm > 0.02 ) {                       // uniform branch, fully coherent
          // Cells of 0.45 and 0.22 units (1.4 m and 0.7 m), so a ring reads as a drop
          // strike and not as a porthole; and only inside 26 units, because past that a
          // ring is under a pixel and all it can do is alias.
          float rk = uStorm * uNearK * ( 1.0 - smoothstep( 6.0, 26.0, dist ) );
          vec2 g1, g2;
          float r1 = rainRing( vW.xz * 2.2, uTime, 0.0, g1 );
          float r2 = rainRing( vW.xz * 4.5, uTime * 1.27, 11.0, g2 );
          dhRain = ( g1 * 0.0022 + g2 * 0.0011 ) * rk;
          dh += dhRain;
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
        // Foam colour, hoisted above the branch so the air side can reach it for wind
        // streaks. Pure function of fogColor, so moving it changes nothing it did before.
        // Foam from below is a bubble raft, not a highlight: it scatters isotropically,
        // so it is lit by the surface irradiance and replaces BOTH the window and the
        // mirror with the same dull grey-white. 4.6x the irradiance level puts a
        // full-storm whitecap at ~0.33 scene-linear: just over BloomEffect's 0.28, so
        // foam is the one thing on a storm ceiling that glows, and it goes dark on its
        // own at night without a second uniform.
        vec3 foamCol = vec3( 0.86, 0.94, 1.00 ) * dot( fogColor, vec3( 0.36, 0.50, 0.34 ) ) * 4.6;
        float rimK = 0.0;
        vec3 col = vec3( 0.0 );
        // Each side owns an fbm2. Gating them on F keeps the common fragment paying for
        // one, not two: inside the window F is 0.02 so the mirror is invisible, outside it
        // F is 1.0 so the sky is. The branches are spatially coherent (whole window vs
        // whole mirror) and only diverge in the few degrees of the Fresnel rim.
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
          if ( F < 0.998 ) {
            vec3 T = refract( V, -Nf, ETA );
            vec3 win = skyRadiance( T );
            // Snell's window becomes a WINDOW: when the far-side target holds the air
            // world (camera below, uRefrSide 0), the transmitted ray samples the actual
            // raft, ladder and sky instead of an analytic gradient. Falls back to the
            // analytic sky at the screen edges and whenever the pass is off, so the old
            // frame is the floor, never the casualty.
            float rk = uRefrK * ( 1.0 - uRefrSide );
            if ( rk > 0.001 ) {
              float ok; vec3 rs = refrSample( T, V, dh, ok );
              win = mix( win, rs, rk * ok );
            }
            col = win * ( 1.0 - F );
          }
          if ( mf > 0.0 )  col += mirrorRadiance( vW, reflect( V, Nf ), uTime, mk ) * ( F * mf );
        } else {
          // ---- THE SEA FROM ABOVE ------------------------------------------
          // air -> water, no TIR, and the roles swap. Nothing in this branch can run for
          // a fragment the diver sees from below, so none of it can regress the window.
          // rainRing gives exactly one ring per cell per beat on a 0.45-unit (1.35 m)
          // lattice. From below that is a diffuse lens in the window and the lattice never
          // shows; from above, at an eye height of 1.6 units, it reads as a GRID of stamped
          // o's -- measured, it dominated the near field of a full-gale frame. The air side
          // therefore drops it entirely and lets the wind chop carry the rain. Doing rain
          // properly from above needs a stochastic splash field, not one ring per cell;
          // that is a separate piece of work. The from-below normal is untouched.
          vec2 dhA = dh - dhRain + rippleGrad( vW.xz, uTime, uStorm, dist );
          vec3 Na = normalize( vec3( -dhA.x, 1.0, -dhA.y ) );
          float cta = clamp( -dot( V, Na ), 0.0, 1.0 );
          F = F0 + ( 1.0 - F0 ) * pow( 1.0 - cta, 5.0 );
          // Fresnel does the whole job here: 0.020 looking straight down (you see into
          // the water), 0.60 at the 5.7 degrees the raft subtends from an eye 1.6 up
          // (mostly sky), 1.0 at the horizon. What is NOT sky is the body of the sea —
          // the column below sampled along the REFRACTED ray by the same closed form the
          // from-below mirror uses, so from the air you are looking into exactly the
          // water Sal swims in, and it dims with the weather for free.
          // Caustics at 0.55x: from below they are the only contrast a down-going ray can
          // find; from above they are a garnish on a grey sea, and at full strength they
          // read tropical.
          vec3 T = refract( V, Na, 1.0 / ETA );
          vec3 body = seaBody( mirrorRadiance( vW, T, uTime, mk * 0.55 ) );
          // TRANSPARENCY. When the far-side target holds the underwater world (camera
          // in air, uRefrSide 1), the transmission is the actual scene under the
          // surface — drums, tether, Sal descending — already water-fogged by the
          // shared Beer-Lambert chunk in that render. A 15% veil of the analytic body
          // stays on top: even perfectly clear water scatters some of its own column
          // into the eye, and the veil is also what keeps the hand-off seamless where
          // the sample runs off screen and ok fades to the analytic answer.
          float rk = uRefrK * uRefrSide;
          if ( rk > 0.001 ) {
            float ok; vec3 rs = refrSample( T, V, dhA, ok );
            body = mix( body, mix( rs, body, 0.15 ), rk * ok );
          }
          col = body * ( 1.0 - F )
              + skyRadiance( reflect( V, Na ) ) * F;

          // Wind streaks: storm foam blown into lines along the dominant swell's own
          // bearing (WAVE[0], 20 degrees), sampled ~9:1 anisotropically so it reads as
          // streaks and not as blobs. Two octaves multiplied, so the streaks break up
          // instead of running the length of the frame.
          if ( uStorm > 0.02 ) {
            vec2 wr = vec2( vW.x * 0.93969 + vW.z * 0.34202,
                           -vW.x * 0.34202 + vW.z * 0.93969 );
            float sk = vn( vec2( wr.x * 0.030 - uTime * 0.30, wr.y * 0.27 ) )
                     * vn( vec2( wr.x * 0.075 - uTime * 0.52, wr.y * 0.62 ) + 3.7 );
            col = mix( col, foamCol, smoothstep( 0.16, 0.42, sk ) * uStorm * uStorm * 0.55
                     * ( 1.0 - smoothstep( 90.0, 260.0, dist ) ) );
          }
          // The disc stops at 460 units; the sea does not. Its last 30% eases into the
          // same airlight the dome draws past the rim and the fog chunk converges on, so
          // the three meet with no ring. Applied after the foam block below, or a storm
          // whitecap at 400 units would sit on top of the horizon haze.
          rimK = smoothstep( 320.0, 455.0, dist );
        }

        // Deriving foam from |grad h| means only the storm spectrum can ever steepen
        // enough to break. Monte-Carlo over the spectrum (20k samples): calm p99 = 0.078
        // and max 0.095, so a 0.30 calm threshold can never fire; storm p50 = 0.102,
        // p90 = 0.189, max 0.306, so a 0.145 storm threshold covers ~22% of the ceiling.
        // Mixed AFTER the Fresnel composite because it replaces what is underneath.
        float foam = smoothstep( uFoamThr, uFoamThr + 0.05, length( dh ) )
                   * ( 0.20 + 0.80 * uStorm )
                   * ( 0.45 + 0.75 * vn( vW.xz * 0.55 + vec2( uTime * 0.12 ) ) );
        col = mix( col, foamCol, clamp( foam, 0.0, 0.85 ) * uNearK );
        // the LENS is the effect; the fleck is a garnish. Air side keeps a tenth of the
        // fleck for the same reason the air side dropped the ring normal above.
        // Air side is 0.0, not 0.10: the rain field is a REGULAR lattice, and from above
        // it read as an evenly-spaced diagonal band of little circles marching across the
        // near water — obviously procedural. From below it is fine (you see it edge-on
        // through the interface), so only the air branch is muted. It comes back when
        // there is a stochastic splash field to draw instead.
        col += foamCol * rain * 0.25 * ( below ? 1.0 : 0.0 );
        col += vec3( 0.72, 0.80, 0.92 ) * uFlash * 0.30 * uNearK;
        if ( rimK > 0.0 ) col = mix( col, airLight( fogColor ), rimK );

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

  // ONE answer to "is the eye in air", against the real surface under the camera, shared
  // by the background dome and the sea's occlusion. Computed first because both read it.
  // uStormU is set further down from wMurk; one frame of lag on the wave amplitude here
  // is invisible and avoids reordering the whole function.
  _surfH = SURFACE_Y + surfaceHeightAt(camera.position.x, camera.position.z, t, uStormU.value);
  uAir.value = clamp((y - (_surfH - AIR_BAND)) / (2 * AIR_BAND), 0, 1);

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
  // The (1 - d01*3.66) factor is SQUARED, matching the raymarch in
  // postfx.volumetrics.js exactly — the two disagreeing puts billboards where the
  // columns are not, which reads as a bug. See the march for why it steepened.
  const rayBand = Math.max(0, 1 - d01 * 3.66) ** 2 * ms(d01, 0, 0.055);
  uRayFade.value = 0.62 * rayDim * rayBand * (0.82 + 0.18 * Math.sin(t * 0.23));
  rayMesh.visible = uRayFade.value > 0.004;
  // The surface survives to y = -330 instead of being culled at -150. In stratified
  // water the ceiling is the invitation: from the zone-0 floor the column overhead now
  // passes 14.6% blue (3.8% under the old flat model), so there is something up there
  // worth climbing to and it has to still be drawn.
  const sFade = clamp(1 - (-y - 60) / 270, 0, 1);
  surface.visible = sFade > 0.004;

  // THE SKY, driven by weather.js through game.js and by nothing else — there is no
  // second clock up here. Written UNCONDITIONALLY now, not inside the surface's own
  // visibility branch: the dome holds the same uniform objects and it is always drawn,
  // so leaving them stale below y = -330 would freeze the sky mid-cycle. Storms dim it
  // AND grey it out (an overcast sky is grey), thicken the cloud deck and soften the
  // disc, which is what makes a storm ceiling read as overcast rather than as dimmed
  // sunshine, and what takes the sky low and flat when seen from the air.
  const storm = clamp(wEnvSky, 0, 1);
  // The palette was resolved in setWeatherWater; here it is only copied into uniforms.
  uSkyZen.value.set(_pZen[0], _pZen[1], _pZen[2]);
  uSkyHor.value.set(_pHor[0], _pHor[1], _pHor[2]);
  // The disc is a palette stop now, not a night/day crossfade: the night stop IS the
  // moon, so the same ring that walks the sky through dawn walks the disc from moon to
  // amber to white and back to ember. And uSunDir DOES move — see below.
  uSunCol.value.set(_pDisc[0], _pDisc[1], _pDisc[2]);
  // THE LIVE SUN. Written every frame from config.js's authority; the surface material
  // and the dome share this one uniform object, so the disc in the sky, the disc in
  // Snell's window and the glitter path on the sea can never point three ways.
  uSunDirU.value.set(SUN.dir.x, SUN.dir.y, SUN.dir.z);
  // The shafts get the SNELL-CLAMPED sun instead, so they can never rake past 41.4.
  uSunProj.value.set(SUN.proj[0], SUN.proj[1]);
  uSunSize.value = 700 - 560 * storm;
  uCloud.value = 0.22 + 0.70 * storm;
  uStormU.value = storm;

  if (surface.visible) {
    const su = surface.material.uniforms;
    if (su.uFade) su.uFade.value = sFade;   // tolerate a shader built without it
    su.uBright.value = clamp(1 - d01 * 0.6, 0.45, 1) * (0.35 + 0.65 * sFade);
    su.uFlash.value = wFlash;
    su.uFoamThr.value = ml(0.30, 0.145, storm);
    // The caustic sheet in the mirror and the foam/rain/flash detail are near-surface
    // phenomena; retire them well before uFade does, so the deep pays nothing for them.
    su.uMirrorK.value = clamp(1 + y / 70, 0, 1);
    su.uNearK.value = clamp(1 + y / 90, 0, 1);
    // ABOVE the waterline the sea must OCCLUDE. It is drawn transparent at renderOrder
    // -1 with depthWrite off, so every additive thing drawn after it — marine snow, the
    // god-ray billboards, jellies, weather.js's rain plane at y = -0.5 — used to paint
    // straight through it. That is most of what made the sea read as cloud rather than
    // water. Below y = 0 it stays off exactly as before: it is a ceiling, not an
    // occluder, and turning it on down there would clip the whole midwater menagerie.
    // Keyed on the same local-surface answer as the dome, not a flat y > 0. These two
    // disagreeing is what let sky bleed into the underwater far field.
    const occl = uAir.value > 0.5;
    if (surface.material.depthWrite !== occl) surface.material.depthWrite = occl;
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

  dome.material.uniforms.uSurf.value.set(_pSurf[0], _pSurf[1], _pSurf[2]);
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
  // _pSurf is SURF_LIGHT * wSurfK * the palette stop's scale and tint — which at the
  // noon stop is exactly SURF_LIGHT * wSurfK, i.e. the value that shipped. The per-
  // channel Beer-Lambert ramp downstream is untouched; this is still, and only,
  // SURFACE IRRADIANCE.
  scene.fog.color.setRGB(_pSurf[0], _pSurf[1], _pSurf[2], THREE.LinearSRGBColorSpace);
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
