// Ocean surface (Snell's window), volumetric god rays, particulates, bubble vents,
// and the depth-absorption atmosphere model.
// OWNED BY: water/atmosphere agent.
import * as THREE from 'three';
import { scene, camera, renderer } from '../core.js';
import { WORLD_R, SURFACE_Y, SUN, GLASS, SKY, abyssK } from '../config.js';
// Re-exported so the coming lab (and the brief's contract) can reach the tuning surface
// from here. It is DEFINED in config.js — weather.js needs GLASS.sun and this file needs
// GLASS.stops, and config.js is the only module both already import. Plain mutable data:
// poke it live and the next frame picks it up.
export { GLASS } from '../config.js';
// THE VOLUMETRIC SKY (world/sky.js) draws through the dome: its GLSL and uniforms are
// spliced into buildDome, and captureSkyEnv renders it from its panorama.
import { GLSL_VOL_DOME, DOME_U as VOL_DOME_U, volCaptureMode, getSkyEnv, getCloudShadow } from './sky.js';
import { rng, clamp } from '../lib/math.js';
import { maxAniso } from '../lib/textures.js';
// THE SPECTRAL OCEAN: the wave field, its textures, the clipmap and the CPU height query.
import {
  buildOcean, updateOcean, setSeaState, feedOceanWorker, oceanHeightAt, oceanTick, dominantComponents,
  buildOceanGeometry, updateOceanGrid, OCEAN_UNIFORMS, OCEAN_GLSL_DISP, GRID_LEVELS, uOcSea, seaStats
} from './ocean.js';
import { scatter } from './flora.js';
// THE SUN'S SHADOW MAP, read-only. lighting.js imports airAmbience from here, so this
// closes an import cycle — safe because BOTH sides only touch the other's bindings
// inside per-frame functions, never at module evaluation. `sun` is never written here.
import { sun, lanternLight, playerLightSrc, SURFK } from '../lighting.js';
// The vents' warm columns, for the marine snow: a preallocated Float32Array + count,
// filled by vents.js once per reseed and handed to the snow material as uniforms.
import { ventColumns, ventColumnCount, VENT_COLS_MAX } from './vents.js';
import { buildParticulate, updateParticulate, updateSpray, particulateState } from './particulate.js';

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
// OCEAN ROUND: the 2.9 km haze was also what hid the old ocean disc's 460-unit rim.
// The spectral sea runs to the true horizon now (the dome draws the far-sea BRDF past
// camera.far), so clear air can be clear: ~10 km meteorological visibility on a fair
// day, and the WEATHER thickens it (STYLE_U[0] carries the storm haze, so a gale closes
// back to ~2.2 km of spray and rain). A white horizon band is now weather, not a seam.
const K_AIR = [0.00110, 0.00118, 0.00132];
const AIR_STORM_K = 3.2;

// THE FLOW LEAN — atmosphere forward (roadmap/flow-lean-style.md item 3) and the matte
// mirror (item 8). GLASS.style is the dial; each sub-knob follows the master at -1.
// LOCAL helper until config.js grows styleK(); same contract.
const styleK = n => { const st = GLASS.style; return st && st[n] >= 0 ? st[n] : (st ? st.flowLean : 0); };
// ONE shared vec4 every fogged program reads, installed exactly the way abyssaAir is
// (see patchFog): x = air haze gain (KAIR * (1 + x): +1 stop at x = 1), y = nepheloid
// amp gain (amp * (1 + y)), z = matte mirror amount, w = spare. A program never handed
// the uniform reads zeros and is bit-identical to today; at styleK() = 0 every term is
// multiplied by exactly 1.0 or added exactly 0.0, which IEEE makes identity.
const STYLE_U = new Float32Array(4);
export function styleState() { return STYLE_U; }

// LIGHTNING AS A LIGHT (roadmap/ref-lightning-light.md). Two slots of bolt light, installed
// on the fog chunk exactly the way abyssaAir is: xyz = the channel's light anchor in world
// space, w = intensity (0 = slot empty). BOLT_COL = the cold-white colour with the diffuse
// reflectance folded in (the chunk sees the LIT colour, never the albedo, so a flash reads
// as a desaturated cold wash -- which is what a lightning flash does to the eye anyway).
// BOLT_K = (floor distance, water-leg extinction gain, spare, spare). Written by
// world/lightning.js every frame it has a live bolt; a program never handed the uniforms
// reads zeros, and at w = 0 the chunk's bolt block is a single uniform compare.
const BOLT0_U = new Float32Array(4), BOLT1_U = new Float32Array(4);
const BOLT_COL_U = new Float32Array(4), BOLT_K_U = new Float32Array([45, 2, 0, 0]);
export function setBoltLight(i, x, y, z, I) {
  const u = i === 0 ? BOLT0_U : BOLT1_U;
  u[0] = x; u[1] = y; u[2] = z; u[3] = I;
}
export function setBoltParams(r, g, b, floor, depthK) {
  BOLT_COL_U[0] = r; BOLT_COL_U[1] = g; BOLT_COL_U[2] = b;
  BOLT_K_U[0] = floor; BOLT_K_U[1] = depthK;
}
export function boltUniforms() { return { b0: BOLT0_U, b1: BOLT1_U, col: BOLT_COL_U, k: BOLT_K_U }; }

// THE LAMP IN THE MURK (atmos track). Single-scattering in-scatter from point lights,
// integrated in CLOSED FORM along every view ray by the fog chunk and the dome, so Sal's
// lantern carves a glowing volume out of the water and anything between the eye and the
// flame stands silhouetted against it. Two slots, installed on the fog chunk exactly the
// way the bolt uniforms are (a program never handed them reads zeros and the block is
// one uniform compare):
//   LAMP_A  xyz = the lantern's world position, w = its intensity (0 = slot off)
//   LAMP_AC rgb = its colour, w = its range (the same window three lights the scene with)
//   LAMP_B / LAMP_BC  the strongest OTHER submerged point light near the camera (the
//           vent throat, a lit ward, the hoard lamp) — picked on the CPU each frame
//   LAMP_K  rgb = the water's LOCAL extinction at the eye per unit (the same
//           rhoClear*KMOL + silt*KPART the chunk integrates, storm gain included), so the
//           beam reddens and dies with distance exactly as the fog does; w = gain
// Written by updateAtmosphere (after game.js has placed and flickered the lantern).
const LAMPA_U = new Float32Array(4), LAMPAC_U = new Float32Array(4);
const LAMPB_U = new Float32Array(4), LAMPBC_U = new Float32Array(4);
const LAMPK_U = new Float32Array(4);
// The LIGHT leg's per-channel extinction (lamp -> scattering point): the SAME numbers
// lib/surface.js puts on every lit surface (lighting.js SURFK.path x fog.density), so the
// beam in the water and the pool on the sand redden and go teal at one rate -- a warm
// core, a teal-green edge, in the volume exactly as on the rock.
const LAMPP_U = new Float32Array(4);
// TEMPORAL UPSCALING's texture mip bias (postfx.taa.js): x = LOD bias every fogged
// program's map / normalMap / roughness / metalness / emissive taps and the triplanar
// sediment take while TAAU renders below the output resolution (log2 internal/output,
// so a texture is filtered for the pixel the player SEES, and the temporal resolve
// integrates the extra detail). 0 = bit-identical sampling. Same shared-array install
// as every uniform below.
export const TAA_U = new Float32Array(4);
// The diver's two shadow spheres for the lantern's in-scatter (see GLSL_LAMP).
const OCCA_U = new Float32Array(4), OCCB_U = new Float32Array(4);
// game.js hands these over each frame from the rig (chest, helmet: centre + radius).
export function setLampOccluders(o) {
  for (let i = 0; i < 4; i++) { OCCA_U[i] = o[i]; OCCB_U[i] = o[4 + i]; }
  if (!ATMOS.lampOcc) OCCA_U[3] = OCCB_U[3] = 0;
}
// Look knobs, live-pokeable through window.__atmos.
export const ATMOS = {
  // Lantern in-scatter gain (x the physical sigma_s * I * phase). Tuned against the
  // RELIT lantern (lighting.js relight(): underwater intensity x2.4..4, ~25-40): the
  // glow is a halo round the flame that falls to black by ~15 units, not a fog bank.
  lampGain: 0.055,
  lampGainB: 0.6,      // second slot (vent throat / ward / hoard lamp): the furnace glow in the boiler room
  lampOn: true,
  lampOcc: true,       // Sal's body shadows the lantern's glow (A/B: __atmos.ATMOS.lampOcc = false)
  bokeh: true,
  spray: 1            // sea-spray amount multiplier (0 = off)
};

const f = v => v.toFixed(5);
const v3 = a => `vec3(${f(a[0])},${f(a[1])},${f(a[2])})`;
const v2 = a => `vec2(${f(a[0])},${f(a[1])})`;

export const GLSL_NOISE = `
float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*0.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float vn(vec2 p){vec2 i=floor(p),g=fract(p);g=g*g*(3.0-2.0*g);
return mix(mix(h21(i),h21(i+vec2(1,0)),g.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),g.x),g.y);}
float fbm2(vec2 p){float v=0.0,a=0.5;for(int i=0;i<4;i++){v+=a*vn(p);p*=2.07;a*=0.5;}return v;}`;

// Ambient (fully scattered) water radiance at world height y. Evaluated per fragment,
// so one frame can show teal overhead and ink below at the same time.
const SHALLOW_DESAT = 0.28;
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
  vec3 a=surf*exp(${v3(K_ABS)}*min(y,0.0))+zoneGlow(y);
  // SHALLOW CHROMA ROLL-OFF (atmos track). Single-scatter Beer-Lambert leaves the lit
  // shallows with red at ~0 against green and blue, which the display renders as the
  // most saturated cyan it has: measured (43,207,213) sRGB for open water at y = -60,
  // clipping to 250 in the window -- neon, the one thing the brief forbids. Real sunlit
  // water is multiply scattered and skylit, which pulls it toward a paler, bluer teal.
  // Up to ${f(SHALLOW_DESAT)} of the chroma folds into a cool blue-grey (~0.9 of the luminance) at the
  // surface, fading out by y = -300 so the deep zones keep their authored darkness.
  float l=dot(a,vec3(0.2126,0.7152,0.0722));
  return mix(a,l*vec3(0.70,0.92,1.14),${f(SHALLOW_DESAT)}*(1.0-smoothstep(0.0,300.0,-y)));
}`;

// The stratified water profile, shared VERBATIM by the fog chunk and the background
// dome. It has to be both places: the fog chunk's L -> infinity asymptote and the
// dome converge on the identical value only because they evaluate the same functions
// at the same height. (Injecting it into one shader and not the other is not a subtle
// bug — the other one fails to link and there is no background at all.)
const GLSL_WATER = `
uniform vec4 abyssaStyle;
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
  // Flow lean: the silt line one notch thicker (structure untouched -- yf and hs are
  // the layer's shape, amp is only its weight). Mirrored on the CPU in nephAt().
  amp *= 1.0 + abyssaStyle.y;
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
#define KAIR ( ${v3(K_AIR)} * ( 1.0 + abyssaStyle.x ) )

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
// THE AIRLIGHT IS A UNIFORM NOW. abyssaAir = (rgb of the ring the sky actually draws at
// the horizon this frame, flag). The flag is 0 for any program that was never handed
// the uniform (GLSL zero-initialises an unset uniform), so such a program gets the old
// noon bake bit-for-bit instead of black. See patchFog for how a global chunk gets a
// uniform of its own: the value is ONE shared Float32Array installed on
// UniformsLib.fog and on every ShaderLib entry that carries fogColor, and
// UniformsUtils.clone copies a typed array BY REFERENCE, so every material reads the
// same four floats and water.js writes them once a frame.
uniform vec4 abyssaAir, abyssaAirZ;
vec3 airLight( vec3 surfIrr ){
  float dg = clamp( ( surfIrr.g / ${f(SURF_LIGHT[1])} - 0.20 ) / 0.80, 0.0, 1.0 );
  vec3 bake = ${v3(SKY_HOR_D)} * ( 0.0266 + 0.9734 * dg );
  return mix( bake, abyssaAir.rgb, abyssaAir.a );
}`;

// THE BOLT LIGHT (roadmap/ref-lightning-light.md). Two slots, inverse-square with a floor
// distance, lighting every fogged fragment from the bolt's own side. It lives in the fog
// chunk because that is the one piece of GLSL every material in the game already runs:
// a global uniform reaches sea, raft, terrain, Sal and the plankton without touching a
// material. The fragment's diffuse reflectance is not available here (only the lit
// colour is), so it is folded into abyssaBoltCol as a flat cold grey -- a flash bleaches
// colour in the eye too, and it is on screen for two frames.
//   ndl   Lambert against the world normal: the lit side flashes, the far side stays dark.
//   att   floor^2 / max(d^2, floor^2): inverse-square that stops growing inside `floor`,
//         so a strike beside the raft is a flash, not a bleach.
//   trw   the WATER leg. The share of the bolt->fragment path below y = 0 is extinguished
//         by the clear column's total extinction (KMOL, storm-scaled) -- extinction and
//         not the sun's absorption-only K_ABS, because a point source's DIRECT beam loses
//         what scatters out of it (that light is the sheet the sea underside draws).
//         abyssaBoltK.y is the gain on that leg; the nepheloid is ignored (the light is
//         gone long before it reaches a silt line).
//   gBoltK a shader-global on the gSunK pattern: the sea sets it before its include (a
//         specular surface takes a fraction of a diffuse term); every other program
//         keeps the 1.0 initialiser.
const GLSL_BOLT = `
uniform vec4 abyssaBolt0, abyssaBolt1, abyssaBoltCol, abyssaBoltK;
float gBoltK = 1.0;
vec3 boltLight( vec3 P, vec3 N, vec4 B, float storm ){
  vec3  d    = B.xyz - P;
  float d2   = dot( d, d );
  float dist = sqrt( d2 );
  float ndl  = max( dot( N, d ), 0.0 ) / max( dist, 1e-3 );
  float fl2  = abyssaBoltK.x * abyssaBoltK.x;
  float att  = fl2 / max( d2, fl2 );
  float yw   = min( P.y, 0.0 );
  float Lw   = -yw / max( B.y - P.y, 1.0 ) * dist;
  vec3  trw  = exp( -Lw * rhoClearAt( 0.5 * yw ) * storm * abyssaBoltK.y * KMOL );
  return abyssaBoltCol.rgb * ( B.w * ndl * att ) * trw;
}`;

// THE LAMP IN THE MURK — the closed-form airlight of a point source (the Sun et al. 2005
// family, reduced to what a lantern in water needs). Along the view ray x(t) = o + v t,
// with the lamp at perpendicular distance h and closest approach tc, substitute
// t - tc = h tan(th): the inverse-square in-scatter dt / d^2 becomes dth / h EXACTLY, and
// the scattering cosine toward the eye is mu = -sin(th). Water scatters mostly
// FORWARD, which is why a lamp in murk is a halo round the flame and not a lit fog bank,
// so the phase is p(mu) = 0.15 + 0.85 (1 + mu)^4 / 3.2 (sphere mean 1; 4.4 dead ahead,
// 0.42 at right angles, 0.15 behind), and the integral over [0, L] is still elementary:
// with s = sin th, c = cos th,
//   F4(th) = 4.375 th + 8 c - (4/3) c^3 - 3.5 s c + s c (c^2 - s^2) / 8   (= int (1-s)^4)
//   F(th)  = 0.15 th + (0.85 / 3.2) F4(th),    in-scatter = (F(th1) - F(th0)) / h
// and sin/cos come back algebraically from u = tan(th), so the only transcendentals are
// two atan. The extinction exp(-sigma_eye t - sigma_light d) -- the eye leg at the fog's
// own local extinction, the light leg at lib/surface.js's path extinction so the beam and
// the lit pool agree -- is taken at the ray's closest point to the lamp (clamped to the
// segment) -- the integrand is concentrated within +-h of it, and h
// for a lantern held beside the camera is a few units, so the error is a small fraction of
// one mean free path. Every exp() argument is -sigma * (non-negative), so <= 0.
// The window is three's own range falloff (1 - (d/R)^4)^2 at that same closest point, so
// the glow can never reach water the lamp does not light on surfaces.
// Requires LAMPK_U etc. installed as uniforms (patchFog / the dome).
// THE DIVER'S SHADOW IN THE GLOW. The lantern hangs at Sal's side, so his own body
// stands in its light: the water behind his chest and helmet (as seen from the flame)
// is NOT lit, and a ray through that water collects no glow there. Without this the
// halo painted straight over his back whenever the lamp was on his far side, and the
// murk on his unlit flank glowed like the lit one. The occluders are two analytic
// spheres (chest, helmet: abyssaOccA/B, xyz + radius, written by game.js from the rig
// each frame; r = 0 turns one off). A sphere's shadow from a point source is the
// forward nappe of a cone (apex at the flame, half-angle asin(r/D)) beyond the
// sphere: a quadric, so a view ray crosses it in ONE interval, found in closed form.
// The in-scatter over that interval is the same elementary integral as the lit
// segment's (lampSeg, two more atan), and it is subtracted; where the two shadow
// intervals overlap the overlap is added back once. Slot A (the lantern) only.
const GLSL_LAMP = `
uniform vec4 abyssaLampA, abyssaLampAC, abyssaLampB, abyssaLampBC, abyssaLampK, abyssaLampP;
uniform vec4 abyssaOccA, abyssaOccB;
float lampF( float u ){
  float c = inversesqrt( 1.0 + u * u ), s = u * c, th = atan( u );
  float f4 = 4.375 * th + c * ( 8.0 - 1.3333333 * c * c )
           + s * c * ( 0.125 * ( c * c - s * s ) - 3.5 );
  return 0.15 * th + 0.265625 * f4;
}
// In-scatter from the segment [t0, t1] of the ray (t0 = 0, t1 = L is the whole path).
vec3 lampSeg( vec3 ro, vec3 v, float t0, float t1, vec4 P, vec4 C ){
  vec3  dp  = P.xyz - ro;
  float tc  = dot( dp, v );
  float h2  = max( dot( dp, dp ) - tc * tc, 0.09 );
  float tm  = clamp( tc, t0, t1 );
  float dm2 = h2 + ( tm - tc ) * ( tm - tc );
  float q   = dm2 / max( C.w * C.w, 1.0 );
  // Out of the lamp's reach along the whole segment: no atan, no exp.
  if ( q >= 1.0 ) return vec3( 0.0 );
  float win = 1.0 - q * q;
  float ih  = inversesqrt( h2 );
  float geo = max( lampF( ( t1 - tc ) * ih ) - lampF( ( t0 - tc ) * ih ), 0.0 ) * ih;
  vec3  trl = exp( -abyssaLampK.rgb * tm - abyssaLampP.rgb * sqrt( dm2 ) );
  return C.rgb * ( P.w * geo * win * win ) * trl;
}
vec3 lampScatter( vec3 ro, vec3 v, float L, vec4 P, vec4 C ){ return lampSeg( ro, v, 0.0, L, P, C ); }
// The interval of [0, L] inside sphere S's shadow from the point P (empty: x >= y).
vec2 lampShadow( vec3 ro, vec3 v, float L, vec3 P, vec4 S ){
  vec2 no = vec2( 1.0, 0.0 );
  if ( S.w <= 0.0 ) return no;
  vec3  a  = S.xyz - P;
  float D2 = dot( a, a ), r2 = S.w * S.w;
  if ( D2 <= r2 * 1.05 ) return no;               // flame at or inside the occluder
  float D  = sqrt( D2 );
  vec3  ax = a / D;
  float k  = 1.0 - r2 / D2;                        // cos^2 of the cone's half-angle
  vec3  w  = ro - P;
  float dv = dot( v, ax ), dw = dot( w, ax );
  // f(t) = (ax.(x - P))^2 - k |x - P|^2 >= 0 inside the double cone
  float A = dv * dv - k, B = dv * dw - k * dot( v, w ), Cq = dw * dw - k * dot( w, w );
  float disc = B * B - A * Cq;
  vec2 sp;
  if ( abs( A ) < 1e-5 || disc < 0.0 ) {
    // parallel to the cone's wall, or never crossing it: inside all along or not at all
    if ( Cq < 0.0 || dw < 0.0 ) return no;
    sp = vec2( -1e9, 1e9 );
  } else {
    float sq = sqrt( disc );
    float r1 = ( -B - sq ) / A, r2b = ( -B + sq ) / A;
    float lo = min( r1, r2b ), hi = max( r1, r2b );
    if ( A < 0.0 ) {
      if ( dw + dv * 0.5 * ( lo + hi ) < 0.0 ) return no;   // that is the back nappe
      sp = vec2( lo, hi );
    } else {
      sp = ( dw + dv * ( hi + 1.0 ) > 0.0 ) ? vec2( hi, 1e9 ) : vec2( -1e9, lo );
    }
  }
  // only BEHIND the occluder (beyond the plane through its centre, facing the flame)
  if ( abs( dv ) > 1e-5 ) {
    float th = ( D - dw ) / dv;
    if ( dv > 0.0 ) sp.x = max( sp.x, th ); else sp.y = min( sp.y, th );
  } else if ( dw < D ) return no;
  return vec2( max( sp.x, 0.0 ), min( sp.y, L ) );
}
// Both slots, scaled by the scattering coefficient (green local extinction, the channel
// the silt line is calibrated on) and the gain, then rolled off by a soft shoulder so a
// ray grazing the flame can never clip: x / (1 + mean(x)) keeps the hue of the beam.
vec3 lampAirlight( vec3 ro, vec3 v, float L ){
  vec3 x = vec3( 0.0 );
  if ( abyssaLampA.w > 0.0 ) {
    x += lampScatter( ro, v, L, abyssaLampA, abyssaLampAC );
    vec2 sa = lampShadow( ro, v, L, abyssaLampA.xyz, abyssaOccA );
    vec2 sb = lampShadow( ro, v, L, abyssaLampA.xyz, abyssaOccB );
    if ( sa.x < sa.y ) x -= lampSeg( ro, v, sa.x, sa.y, abyssaLampA, abyssaLampAC );
    if ( sb.x < sb.y ) x -= lampSeg( ro, v, sb.x, sb.y, abyssaLampA, abyssaLampAC );
    float o0 = max( sa.x, sb.x ), o1 = min( sa.y, sb.y );
    if ( sa.x < sa.y && sb.x < sb.y && o0 < o1 ) x += lampSeg( ro, v, o0, o1, abyssaLampA, abyssaLampAC );
    x = max( x, vec3( 0.0 ) );
  }
  if ( abyssaLampB.w > 0.0 ) x += lampScatter( ro, v, L, abyssaLampB, abyssaLampBC );
  x *= abyssaLampK.g * abyssaLampK.w;
  return x / ( 1.0 + dot( x, vec3( 0.3333 ) ) );
}`;

// THE SKY. One function, used by the ocean surface on BOTH sides of the interface and by
// the background dome, so the sky seen from the air and the sky compressed into Snell's
// window from below are literally the same image. The body grew out of the window-only
// version, and it stays ONE function for exactly that reason: consistency between the
// two views. Everything the SKY DRAMA card added — cumulus, the marine layer's white-out
// and the moon — therefore appears in Snell's window too, which is the point.
// Requires GLSL_NOISE (fbm2) and the uSky*/uSun*/uCloud*/uMoon*/uFog* uniforms.
//
// THE CLOUD FIELD is one fbm on a plane projected overhead (the ray's xz divided by its
// own elevation), so the deck parallaxes with the view instead of being a texture stuck
// to the sky. `uCloudDrift` is integrated ON THE CPU from wind.dir/wind.speed — there is
// no per-frame trig in here and none in the JS hot path beyond one sin/cos.
//   coverage  threshold on the field, from hand.clouds (+ the storm envelope)
//   soft      edge width: a fair cumulus has a hard edge, a storm deck has none
//   uCloudTex thickness — flattens the lighting response and darkens the underside
// Sun-lit edges come from ONE extra fbm sample taken a short step TOWARD the sun's
// bearing (uSunUV, precomputed on the CPU): where the field falls off in that direction
// the fragment is on the sunward flank of a cloud, and that is the flank that catches
// the light. At the dawn/dusk stops the CPU walks uCloudBase toward the disc colour by
// hand.sunsetDrama, which is the post-storm-clearing payoff — see cloudColours().
// SECOND fbm: gated behind the coverage test, so a cloudless day pays for neither.
const GLSL_SKY = `
// gSunK scales the sun DISC only. A shader-global, not a uniform, so the sea can set it
// per fragment (the raft's shadow dims the glitter it would otherwise reflect) while the
// dome, which never writes it, keeps the constant 1.0 initialiser.
float gSunK = 1.0;
// gHaloK scales the disc's AUREOLE (the 0.055 pow-14 skirt) on the same terms. The sea
// splits them: with GGX glitter on, the sharp disc is multiplied OUT of the reflected
// sky (gSunK 0) and drawn as a microfacet lobe instead, while the aureole -- sky, not
// sun -- stays in the mirror.
float gHaloK = 1.0;
// The cloud occlusion at the LAST direction skyRadiance was asked about, left behind so
// a caller shading a specular lobe toward that same direction can honour the deck the
// way the painted disc does. The dome writes it and never reads it.
float gOcc = 1.0;
vec3 skyRadiance( vec3 d ){
  float up = clamp( d.y, 0.0, 1.0 );
  // THE GRADIENT HUGS THE HORIZON. sqrt(up) put the half-way point at 15 degrees, so
  // the pale horizon radiance (6x the zenith at noon) washed the lower third of every
  // sky and the deck read milky under a white lid. A real clear sky brightens only in
  // the last ~10 degrees -- the optical air mass climbs as 1/sin(elevation) and only
  // gets large right at the horizon -- so the blend runs on 1 - (1 - up)^5: the SAME
  // horizon value at up = 0 (the airlight, the fog chunk's asymptote and the ocean
  // rim still meet on one number) and the same zenith, with the blue claimed from ~20
  // degrees up (0.67 of the way at 12 degrees against sqrt's 0.46).
  float hz = 1.0 - up; hz *= hz; hz *= hz * ( 1.0 - up );
  vec3 c = mix( uSkyHor, uSkyZen, 1.0 - hz );
  // A broad forward (Mie) glow round the sun: the aerosol the marine haze is made of
  // scatters forward, so the sky is brighter and warmer toward the sun and the whole
  // dome gains a direction instead of being a radial gradient. Uses the disc colour,
  // scaled far below it: 0.9% of the disc dead on the sun, 0.2% at 40 degrees off.
  float sdm = max( 0.0, dot( d, uSunDir ) );
  c += uSunCol * uDiscK * ( 0.009 * sdm * sdm * sdm );

  float amt = 0.0;
  if ( uCloudCov > 0.005 ) {
    // The overhead-plane projection, softened at the horizon where its derivative blows
    // up. This is ( up + 0.10 ), NOT max( up, 0.10 ): the clamped form freezes the uv
    // below 5.7 degrees, so whatever pattern sits at that elevation extends straight
    // down as a vertical column — measured as pale curtains standing on the waterline
    // in the first build of this card. The additive form has no discontinuity in its
    // derivative anywhere, so the field simply compresses harder and harder toward the
    // horizon, which is the perspective this card is trying to buy in the first place.
    vec2 uv = ( d.xz / ( up + 0.10 ) ) * uCloudScale + uCloudDrift;
    float fv = fbm2( uv );
    // ISLANDS. One low-frequency value-noise blob field (ONE vn sample, not an fbm)
    // decides WHERE cloud is allowed to exist at all: "open" is 1 inside a blob and 0
    // between them, and the coverage threshold swings +/- uCloudIsl.w across that. The
    // swing is TWO-SIDED on purpose — a one-sided penalty just raises the mean threshold
    // and empties the whole sky (measured: 12.9% cover -> 0.7%). Two-sided keeps the
    // shipped coverage mapping honest while cutting the field into separated clumps with
    // clear sky between them, and gives them SIZE VARIETY, which is most of what says
    // "weather" rather than "texture". uCloudIsl.w is faded out by coverage on the CPU,
    // so a storm deck still closes into one lid.
    float open = smoothstep( uCloudIsl.y, uCloudIsl.y + uCloudIsl.z,
                             vn( uv * uCloudIsl.x + vec2( 17.3, 5.9 ) ) );
    // RAGGED EDGE: one high-frequency vn perturbing the density either way, so the
    // silhouette tears instead of following the fbm's own smooth contour. The sample is
    // KEPT (rag) because the FORM block below reuses it as cauliflower surface texture —
    // the same noise that tears the silhouette is the lumpiness on the flank, which is
    // what a real cumulus is: one process seen in profile and in relief.
    float rag = vn( uv * uCloudShp.x + vec2( 41.7, 23.1 ) ) - 0.5;
    float dens = fv + uCloudShp.y * rag;
    // fbm2 is 4 octaves at halving amplitude: range [0, 0.9375], mean ~0.47. A threshold
    // sweeping 0.72 -> 0.22 therefore walks from "a few wisps" to "solid lid".
    // HORIZON GATHERING is the last term: perspective compresses a cloud layer into a
    // band low in the sky and leaves the zenith clean, so the threshold climbs with view
    // elevation. Together with the horizon fade below (0.02..0.30 -> 0.008..0.075, which
    // unlocks the whole 1-17 degree band the shipped version suppressed) this INVERTS
    // the elevation profile rather than adding cloud: measured cover by band at
    // hand.clouds 0.4 went 0.1/8.4/13.1/23.3% (2-10/10-25/25-45/45-90 deg) to
    // 9.1/13.3/17.1/7.7% — same total, gathered low, zenith cap 24.4% -> 7.5%.
    float thr = 0.72 - 0.50 * uCloudCov
              + uCloudIsl.w * ( 1.0 - 2.0 * open )
              + uCloudShp.z * smoothstep( 0.35, 0.95, up );
    amt = smoothstep( thr, thr + uCloudSoft, dens ) * smoothstep( 0.008, 0.075, up );
    // THE MILKY BAND. The lowest few degrees dissolve the cloud back into the sky it
    // sits in, so silhouettes never clip against the waterline. This attenuates the
    // cloud's OWN amount rather than tinting the result, which is why it cannot
    // double-apply with the marine layer's airFog (that whites the whole sky on a fog
    // day; this is the clear-day haze and is subtler by construction). Measured on the
    // rendered frame: per-row cloud/sky contrast falls from 18.2 code values in the cloud
    // band to 5.5 at the waterline, which is the sea-glint/dither floor.
    amt *= 1.0 - ${f(GLASS.cloud.hazeK)} * ( 1.0 - smoothstep( 0.0, uCloudShp.w, up ) );
    // THE DOME/PUFF HANDOFF. world/clouds.js draws real instanced puff clusters in the
    // air; this painted layer stays, faded to GLASS.cloud.dome, as the DISTANT BACKDROP
    // the puffs fade into (and as the A/B: dome = 1 is the shipped painted sky, 0 is
    // puffs alone). It is driven back to 1 by the storm envelope, because a gale's lid
    // is a lid — the puff clusters fade out under it and the deck takes over. Scaling
    // the AMOUNT (not the colour) means the disc occlusion below tracks it for free.
    amt *= uCloudDome;
    float g = fv - fbm2( uv + uSunUV );
    float k = clamp( 0.55 - 0.35 * uCloudTex + ( 1.7 + 1.6 * uCloudTex ) * g, 0.0, 1.0 );

    // ---- FORM ------------------------------------------------------------
    // The shaping pass gave every clump its own silhouette and the sky read as a
    // well-cut STENCIL: correct outlines, no interior. Michael: "clouds seem really
    // flat still, no dimension." Everything below adds relief to the interior of a
    // clump, and it adds ZERO noise samples — both signals are already on the stack.
    //
    // (1) THE FLANK. g is the density gradient toward the sun's uv bearing, so its
    // SIGN is which side of the lump a fragment is on: g > 0 means the field falls away
    // sunward = a face turned into the light; g < 0 means it climbs = the shadowed
    // side. The shipped k folded that into one continuous ramp, which is a soft
    // vignette, not a terminator. lit re-reads the same number through a narrow
    // smoothstep so the two flanks SEPARATE, and the shade factor multiplies the whole
    // lighting response down on the far side. This is the term that makes a clump look
    // like a solid with a light on one side of it.
    // g is REUSED, not re-sampled. A second fbm2 at a shorter sunward step (0.15/0.30/
    // 0.50 of uSunUV) was built and measured against this: it bought a little more
    // within-clump range (comp2 1.96 -> 2.03) and LOST the thing the term exists for —
    // the sunward/anti-sunward mean ratio went 0.947 -> 0.994, i.e. back toward
    // directionless. The long step is the better flank signal AND the free one, so the
    // whole dimension pass adds no noise evaluation anywhere.
    float lit = smoothstep( -uCloudFrm.x, uCloudFrm.x, g );
    // (2) THE VERTICAL PROFILE. Distance above the coverage threshold is a free proxy
    // for height in the cloud: at dens == thr you are on the skirt where the body
    // feathers out (the flat dark base), and deep inside is the massif that towers.
    // hgt therefore darkens the base band and gates the top highlight, which is the
    // difference between a disc and a dome. uCloudFrm.w is faded out on the CPU as
    // uCloudBak rises so this can NEVER double-darken with the dusk base term — at the
    // ring stops the backlit pow owns the bases outright and this contributes nothing.
    float hgt = smoothstep( 0.0, uCloudFrm.y, dens - thr );
    k *= mix( 1.0 - uCloudFrm.z, 1.0, lit );      // shadow flank
    k *= mix( 1.0 - uCloudFrm.w, 1.0, hgt );      // dark flat base skirt
    // (3) THE CROWN + CAULIFLOWER. The highlight needs BOTH deep density and a sunward
    // face, so it lands on the top of the massif rather than washing the whole clump;
    // hgt is squared to keep it off the shoulders. The detail term rides lit for the
    // same reason relief photographs at raking light and vanishes at noon-on-a-wall:
    // shadow flanks go smooth and featureless, and THAT is what makes the lit side read
    // as curvature. k is clamped, so the brightest possible fragment is still exactly
    // uCloudLit — the 0.85x horizon bloom cap holds by construction, not by tuning.
    k = clamp( k + uCloudFrm2.x * hgt * hgt * lit + uCloudFrm2.y * rag * lit * hgt,
               0.0, 1.0 );
    // BACKLIT BASES. uCloudBak rises as the sun sinks to the ring stops. The curve is a
    // pow, not a scale: it collapses the middle of the response toward the base colour
    // and leaves only the strongest sunward flanks lit, which is exactly a backlit cloud
    // — a dark body with a bright torn rim. At midday uCloudBak is 0 and lit tops
    // dominate, byte-identical to what shipped.
    k = mix( k, pow( k, ${f(GLASS.cloud.backPow)} ) * ${f(GLASS.cloud.backK)}, uCloudBak );
    c = mix( c, mix( uCloudBase, uCloudLit, k ), amt );
  }
  // The discs sit BEHIND the deck: a cloud in front of the sun occludes it (0.92, not
  // 1.0 — a thin edge still glows through, which is most of what says "cloud").
  float occ = 1.0 - amt * 0.92;
  float sd = max( 0.0, dot( d, uSunDir ) );
  gOcc = occ;
  c += uSunCol * uDiscK * ( pow( sd, uSunSize ) * gSunK + 0.055 * pow( sd, 14.0 ) * gHaloK ) * occ;

  // THE MOON. Not a pow() lobe like the sun but a real disc with a terminator: at this
  // art scale a smoothstep against the angular radius and one signed cut across it is
  // enough to read as a phase, and the earthshine term keeps the unlit limb a sphere
  // rather than a bite. uMoonPh = (lit side, terminator position, earthshine, halo).
  // uMoonCol is zeroed by day, so daylight costs one compare.
  if ( uMoonCol.b > 0.001 ) {
    float md = dot( d, uMoonDir );
    if ( md > 0.0 ) {
      vec3 tv = d - uMoonDir * md;
      float ang = length( tv );
      float body = 1.0 - smoothstep( uMoonR * 0.88, uMoonR, ang );
      float xn = dot( tv, uMoonRight ) / uMoonR;
      float lit = smoothstep( uMoonPh.y - 0.12, uMoonPh.y + 0.12, xn * uMoonPh.x );
      c += uMoonCol * occ
         * ( body * ( uMoonPh.z + ( 1.0 - uMoonPh.z ) * lit ) + uMoonPh.w * pow( md, 240.0 ) );
    }
  }
  return c;
}

// THE MARINE LAYER — the AIR side only. uFog is the live amount (hand.fog past its
// threshold, thinned as the sun climbs toward hand.fogBurn: burn-off comes from above).
// It is applied by the DOME's air path and by the sea's from-above branch, and by
// NOTHING ELSE: the underwater dome, the fog chunk, fog.density and every Beer-Lambert
// consumer are untouched, which is the load-bearing constraint on this whole card.
// The vertical profile is the burn-off in space rather than in time — thickest at the
// horizon, ${f(GLASS.fog.zenK)} of that at the zenith, so the sun is a pale disc in a
// bright lid while the horizon has simply gone.
vec3 airFog( vec3 c, float upness, float distK ){
  if ( uFog <= 0.002 ) return c;
  float k = uFog * mix( 1.0, ${f(GLASS.fog.zenK)}, smoothstep( 0.0, 0.55, upness ) ) * distK;
  return mix( c, uFogCol, clamp( k, 0.0, 1.0 ) );
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
// THE COVERAGE ALONE, for the crepuscular-ray occlusion mask (postfx.skyrays.js). The
// same expressions as the coverage half of skyRadiance above, line for line, minus the
// colour work and minus uCloudDome (the mask wants the FIELD, not the painted layer's
// faded share of it). Requires GLSL_NOISE + GLSL_SKY_DECL, and the SKY_UNIFORMS map, so
// the hole the rays fan out of is exactly where the dome and the sea both draw sky.
// Kept BESIDE skyRadiance rather than refactored out of it: the dome/sea shader text is
// a regression anchor and this must never change a byte of it.
export const GLSL_SKY_COVERAGE = `
float skyCloudAmt( vec3 d ){
  float up = clamp( d.y, 0.0, 1.0 );
  if ( uCloudCov <= 0.005 ) return 0.0;
  vec2 uv = ( d.xz / ( up + 0.10 ) ) * uCloudScale + uCloudDrift;
  float fv = fbm2( uv );
  float open = smoothstep( uCloudIsl.y, uCloudIsl.y + uCloudIsl.z,
                           vn( uv * uCloudIsl.x + vec2( 17.3, 5.9 ) ) );
  float rag = vn( uv * uCloudShp.x + vec2( 41.7, 23.1 ) ) - 0.5;
  float dens = fv + uCloudShp.y * rag;
  float thr = 0.72 - 0.50 * uCloudCov
            + uCloudIsl.w * ( 1.0 - 2.0 * open )
            + uCloudShp.z * smoothstep( 0.35, 0.95, up );
  float amt = smoothstep( thr, thr + uCloudSoft, dens ) * smoothstep( 0.008, 0.075, up );
  amt *= 1.0 - ${f(GLASS.cloud.hazeK)} * ( 1.0 - smoothstep( 0.0, uCloudShp.w, up ) );
  return amt;
}`;

// The per-frame sky numbers the ray pass reads (crepuscular-sky). Written at the end of
// updateWater, after skyDrama has resolved them; a reused object, never copied.
//   cov    resolved cloud coverage (the fog crush included) — the ray WINDOW's input
//   disc   the sun disc palette this frame (scene-linear) — the rays' hue
//   hor    the horizon radiance this frame — the hole's own brightness, the rays' cap
//   discK  fog's cut on the disc (0 = no sun to fan out of)
//   fog    marine-layer amount; air = the camera's air/water blend (1 = in air)
export const skyState = { cov: 0, disc: [0, 0, 0], hor: [0, 0, 0], discK: 1, fog: 0, air: 0, lid: 0 };

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

// ---------------------------------------------------------------------------
// THE DAY HAND. weather.js deals one per day index and hands out the SAME object
// forever; the wind object is likewise reused. So this stores REFERENCES, never copies:
// there is nothing to keep in sync and nothing allocated per frame. Until game.js wires
// it (ONE line, next to setWeatherEnv), everything below falls back to the storm
// envelope alone — which is a plain overcast deck, no fog and no moon, i.e. what
// shipped. Nothing here can break if the wiring is missing.
let wHand = null, wWind = null;
export function setWeatherHand(hand, wind) {
  wHand = hand; wWind = wind || null;
  // The wind TARGET is latched here; updateWater chases it. Storing the target rather
  // than the uniform is what makes the re-aim a property of the water instead of a
  // property of how often game.js happens to call this.
  const w = _wForce || wWind;
  if (w) {
    _wspT = clamp(w.speed, 0, 1);
    // (cos, sin) in the (x, z) plane — the SAME convention WAVE's own `deg` column uses
    // and the same one the sky's uCloudDrift integrates, so the chop, the cloud deck and
    // the undercurrent all point one way. Getting this 90 degrees out is silent.
    _wdTX = Math.cos(w.dir); _wdTZ = Math.sin(w.dir);
  } else { _wspT = 0; }
}
// Read by lighting.js (see the note there): the marine layer's flat white light and a
// bright moon's lift are AMBIENCE, not new Light objects.
// sunVis: the volumetric deck's sun transmittance over the raft (world/sky.js), 1 = clear.
export const airAmbience = { fog: 0, moon: 0, sunVis: 1 };

// Dev surface, namespaced and kept (the convention in CLAUDE.md). `sync()` snapshots the
// live hand/wind off window.weather and installs it, which is what lets a probe FORCE a
// hand — poke __sky.h.fog / .clouds / .moonK and the sky answers on the next frame —
// without weather.js or game.js knowing. Once game.js calls setWeatherHand every frame,
// sync() is just a way to freeze a hand for a screenshot.
if (typeof window !== 'undefined') {
  window.__sky = {
    // The tuning surface itself, so a probe (and the lab) can A/B a stop live.
    G: GLASS,
    // The Flow-lean vec4 every fogged program reads this frame (see STYLE_U).
    style: () => Array.from(STYLE_U),
    dbg(n) { uDbg.value = +n || 0; return uDbg.value; },
    h: null, w: { speed: 0, dir: 0 },
    sync() {
      if (!window.weather) return null;
      this.h = window.weather.hand();
      const w = window.weather.wind();
      this.w.speed = w.speed; this.w.dir = w.dir;
      setWeatherHand(this.h, this.w);
      return this.h;
    },
    release() { setWeatherHand(null, null); this.h = null; },
    // Force the wind, over the top of whatever game.js pushes each frame. The EASE still
    // runs, which is the point: wind(0.9, 1.57) is how you watch the chop re-aim.
    wind(speed, dir) {
      _wForce = { speed, dir: dir === undefined ? (_wForce ? _wForce.dir : 0) : dir };
      setWeatherHand(wHand, wWind);
      return _wForce;
    },
    windOff() { _wForce = null; setWeatherHand(wHand, wWind); },
    // Snap the ease home, for a screenshot that should not have to wait 16 seconds.
    windSnap() { _wsp = _wspT; _wdX = _wdTX; _wdZ = _wdTZ; },
    probe() {
      return {
        cov: uCloudCov.value, soft: uCloudSoft.value, tex: uCloudTex.value,
        isl: uCloudIsl.value.toArray(), shp: uCloudShp.value.toArray(), bak: uCloudBak.value,
        frm: uCloudFrm.value.toArray(), frm2: uCloudFrm2.value.toArray(),
        skyHor: uSkyHor.value.toArray(), skyZen: uSkyZen.value.toArray(),
        pHor: _pHor.slice(), lid: cloudLook.lid, airL: Array.from(AIR_U),
        drift: [uCloudDrift.value.x, uCloudDrift.value.y],
        lit: uCloudLit.value.toArray(), base: uCloudBase.value.toArray(),
        fog: uFog.value, fogCol: uFogCol.value.toArray(), discK: uDiscK.value,
        moon: uMoonCol.value.toArray(), moonDir: uMoonDir.value.toArray(),
        moonPh: uMoonPh.value.toArray(),
        amb: { fog: airAmbience.fog, moon: airAmbience.moon },
        // F1/F2 wiring proof: the day/flash the water actually holds this frame.
        wDay, wFlash, envMap: !!envRT,
        windS: uWindS.value, windD: [uWindD.value.x, uWindD.value.y],
        windT: [_wspT, _wdTX, _wdTZ], forced: !!_wForce,
        windK: [uWindK.value.x, uWindK.value.y], cap: [uCap.value.x, uCap.value.y],
        chop: uChop.value.toArray(), chop2: uChop2.value.toArray(),
        lagW: uLagW.value.toArray(), surfH: _surfH, air: uAir.value,
        // OPACITY / BREAKERS probe. `opq` is the global (foam-free) churned-water
        // opacity; `wAir`/`wBelow` are the transmission WEIGHTS the shader multiplies
        // the refracted scene by on each side, and `refrK` is the pass's own gate
        // (0 also means the pass was skipped this frame — see refrSkipped).
        opaq: uOpaq.value.toArray(), opaq2: [uOpaq2.value.x, uOpaq2.value.y],
        spill: uSpill.value.toArray(),
        opq: (() => {
          const C = GLASS.chop;
          return C.opaqK * ms(Math.max(uStormU.value, uWindS.value), C.opaqLo, C.opaqHi);
        })(),
        get wAir() { return uRefrK.value * uRefrSide.value * (1 - this.opq); },
        get wBelow() { return uRefrK.value * (1 - uRefrSide.value) * (1 - this.opq * uOpaq2.value.x); },
        refrK: uRefrK.value, refrSide: uRefrSide.value, refrSkipped,
        // SURFACE FILTERING / FOAM ACCUMULATOR probe.
        det: uDet.value.toArray(), rough: uRough.value.toArray(), glit: [uGlit.value.x, uGlit.value.y],
        ocean: seaStats()
      };
    },
  };
}

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
// The resolved storm target (storm <-> stormDay by the solar-height gate), and the gate
// itself. Module-scoped so nothing allocates per frame and so skyDrama() reads the SAME
// _dayG the palette used rather than a second copy of the expression.
const _sZen = [0, 0, 0], _sHor = [0, 0, 0], _sDisc = [0, 0, 0], _sTint = [0, 0, 0];
let _dayG = 0;

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
  // THE SUNLIT-STORM GATE. The sun's own height (SUN.dir.y = sin of the solar elevation),
  // read from the one live sun every other consumer reads, over the same window the
  // broad-body SSS uses — so the sky brightens, the desaturation lifts and the water
  // starts to glow on ONE curve rather than three that can disagree.
  //
  // Stored module-wide because skyDrama() needs the identical value for the cloud lid a
  // few lines later in the same frame, and recomputing it there is how the sky and its
  // clouds end up gated slightly differently after someone edits one of them.
  //
  // At night SUN.dir.y sits at the elevNight floor (8 deg, sin 0.139) which is below
  // sssDayLo, so _dayG is EXACTLY 0 and every line below reduces to the shipped storm
  // blend. That identity is the night-gale anchor, and it is structural, not tuned.
  _dayG = ms(SUN.dir.y, GLASS.chop.sssDayLo, GLASS.chop.sssDayHi);
  if (s > 0) {
    // The storm TARGET is itself a blend of two authored stops before it touches the
    // ring: slate at night, the bright reference gale by day. Resolving it here rather
    // than day-scaling each pull separately is what lets zen and hor move too — and the
    // far sea is mostly reflected sky, so zen and hor are most of the problem.
    const T = S.storm, D = S.stormDay, g = _dayG;
    _sZen[0] = T.zen[0] + (D.zen[0] - T.zen[0]) * g;
    _sZen[1] = T.zen[1] + (D.zen[1] - T.zen[1]) * g;
    _sZen[2] = T.zen[2] + (D.zen[2] - T.zen[2]) * g;
    _sHor[0] = T.hor[0] + (D.hor[0] - T.hor[0]) * g;
    _sHor[1] = T.hor[1] + (D.hor[1] - T.hor[1]) * g;
    _sHor[2] = T.hor[2] + (D.hor[2] - T.hor[2]) * g;
    _sDisc[0] = T.disc[0] + (D.disc[0] - T.disc[0]) * g;
    _sDisc[1] = T.disc[1] + (D.disc[1] - T.disc[1]) * g;
    _sDisc[2] = T.disc[2] + (D.disc[2] - T.disc[2]) * g;
    _sTint[0] = T.tint[0] + (D.tint[0] - T.tint[0]) * g;
    _sTint[1] = T.tint[1] + (D.tint[1] - T.tint[1]) * g;
    _sTint[2] = T.tint[2] + (D.tint[2] - T.tint[2]) * g;
    toward3(_pZen, _sZen, s);
    toward3(_pHor, _sHor, s);
    toward3(_pDisc, _sDisc, s);
    toward3(_pSurf, _sTint, s);
    sk += ((T.surfK + (D.surfK - T.surfK) * g) - sk) * s;
    _pDesat += ((T.desat + (D.desat - T.desat) * g) - _pDesat) * s;
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
  let r = _pSurf[0] * Math.exp(K_ABS[0] * d) + ml(ml(0.0020, 0.0064, a), 0.0123, b) * c;
  let g = _pSurf[1] * Math.exp(K_ABS[1] * d) + ml(ml(0.0073, 0.0027, a), 0.0042, b) * c;
  let bl = _pSurf[2] * Math.exp(K_ABS[2] * d) + ml(ml(0.0115, 0.0127, a), 0.0025, b) * c;
  // Mirror of the shallow chroma roll-off in GLSL_AMBIENT (same constants, same curve).
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  const k = SHALLOW_DESAT * (1 - ms(-y, 0, 300));
  r += (l * 0.70 - r) * k; g += (l * 0.92 - g) * k; bl += (l * 1.14 - bl) * k;
  return out.setRGB(r, g, bl, THREE.LinearSRGBColorSpace);
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
  // Same Flow-lean gain the shader applies (STYLE_U[1]); 1 + 0 is exact at lean 0.
  _neph.amp = ml(ml(NEPH_AMP[0], NEPH_AMP[1], t1), NEPH_AMP[2], t2) * (1 + STYLE_U[1]);
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
// The one airlight every fogged program reads (see abyssaAir in GLSL_AIR). Written by
// skyDrama; .a stays 0 until the first frame resolves it, which is the noon bake.
const AIR_U = new Float32Array(4);
// The sky's ZENITH as the far air field sees it (rgb, flag): the palette zenith pulled
// toward the cloud deck's own colour by the painted coverage, so under a lid the haze
// above the horizon darkens with the lid. Written by skyDrama beside AIR_U.
const AIRZ_U = new Float32Array(4);

(function patchFog() {
  const C = THREE.ShaderChunk;
  // Hand the global chunk a uniform: the SAME Float32Array on UniformsLib.fog (our own
  // ShaderMaterials clone that) and on every ShaderLib entry three already merged at
  // its module-eval (the built-ins clone THOSE, not UniformsLib). WebGLUniforms only
  // builds setters for uniforms the linked program actually uses, so an entry on a
  // material whose shader never mentions abyssaAir costs nothing; a fogged program
  // WITHOUT the entry would throw in upload(), which is why both tables get it.
  THREE.UniformsLib.fog.abyssaAir = { value: AIR_U };
  THREE.UniformsLib.fog.abyssaAirZ = { value: AIRZ_U };
  THREE.UniformsLib.fog.abyssaStyle = { value: STYLE_U };
  THREE.UniformsLib.fog.abyssaBolt0 = { value: BOLT0_U };
  THREE.UniformsLib.fog.abyssaBolt1 = { value: BOLT1_U };
  THREE.UniformsLib.fog.abyssaBoltCol = { value: BOLT_COL_U };
  THREE.UniformsLib.fog.abyssaBoltK = { value: BOLT_K_U };
  THREE.UniformsLib.fog.abyssaLampA = { value: LAMPA_U };
  THREE.UniformsLib.fog.abyssaLampAC = { value: LAMPAC_U };
  THREE.UniformsLib.fog.abyssaLampB = { value: LAMPB_U };
  THREE.UniformsLib.fog.abyssaLampBC = { value: LAMPBC_U };
  THREE.UniformsLib.fog.abyssaLampK = { value: LAMPK_U };
  THREE.UniformsLib.fog.abyssaLampP = { value: LAMPP_U };
  THREE.UniformsLib.fog.abyssaTaa = { value: TAA_U };
  THREE.UniformsLib.fog.abyssaOccA = { value: OCCA_U };
  THREE.UniformsLib.fog.abyssaOccB = { value: OCCB_U };
  for (const k in THREE.ShaderLib) {
    const u = THREE.ShaderLib[k] && THREE.ShaderLib[k].uniforms;
    if (u && u.fogColor) {
      u.abyssaAir = { value: AIR_U }; u.abyssaAirZ = { value: AIRZ_U }; u.abyssaStyle = { value: STYLE_U };
      u.abyssaBolt0 = { value: BOLT0_U }; u.abyssaBolt1 = { value: BOLT1_U };
      u.abyssaBoltCol = { value: BOLT_COL_U }; u.abyssaBoltK = { value: BOLT_K_U };
      u.abyssaLampA = { value: LAMPA_U }; u.abyssaLampAC = { value: LAMPAC_U };
      u.abyssaLampB = { value: LAMPB_U }; u.abyssaLampBC = { value: LAMPBC_U };
      u.abyssaLampK = { value: LAMPK_U }; u.abyssaLampP = { value: LAMPP_U };
      u.abyssaTaa = { value: TAA_U };
      u.abyssaOccA = { value: OCCA_U }; u.abyssaOccB = { value: OCCB_U };
    }
  }
  // THE BOLT NEEDS A NORMAL, and the fog chunk is shared by materials that have one and
  // materials that do not. Every LIT built-in (Lambert/Phong/Toon/Standard/Physical)
  // includes lights_fragment_begin, textually AFTER normal_fragment_begin has declared
  // the view-space `normal` and BEFORE fog_fragment; a #define planted at its head is
  // therefore visible exactly to the programs that own a normal. Everything else (basic,
  // points, sprites, our ShaderMaterials) takes the screen-derivative flat normal.
  C.lights_fragment_begin = `#define ABYSSA_LIT 1\n` + C.lights_fragment_begin;
  C.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogY;
  varying vec3 vFogP;
#endif`;
  // viewMatrix[1].xyz is row 1 of the inverse view rotation, so world height comes back
  // without needing worldpos_vertex (which is not emitted by every material). vFogP is
  // the same trick for all three axes (v * M == transpose(M) * v, and the transpose of a
  // rotation is its inverse): the bolt light needs the fragment's world position.
  C.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogY = dot( viewMatrix[ 1 ].xyz, mvPosition.xyz ) + cameraPosition.y;
  vFogP = mvPosition.xyz * mat3( viewMatrix ) + cameraPosition;
#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying float vFogY;
  varying vec3 vFogP;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
${GLSL_AMBIENT}
${GLSL_WATER}
${GLSL_AIR}
${GLSL_BOLT}
${GLSL_LAMP}
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

    // --- THE BOLT LIGHT -----------------------------------------------------
    // Added to the fragment's OWN radiance, before the eye leg's extinction below, so a
    // lit deck 30 units off is fogged exactly as its sunlight is. One uniform compare
    // when no bolt is live (every calm frame): the block is skipped whole.
    if ( abyssaBolt0.w + abyssaBolt1.w > 0.0 ) {
      #ifdef ABYSSA_LIT
        vec3 bN = normalize( normal * mat3( viewMatrix ) );
      #else
        vec3 bN = normalize( cross( dFdx( vFogP ), dFdy( vFogP ) ) );
      #endif
      gl_FragColor.rgb += gBoltK * ( boltLight( vFogP, bN, abyssaBolt0, storm )
                                   + boltLight( vFogP, bN, abyssaBolt1, storm ) );
    }

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

    // --- THE LAMP IN THE MURK ------------------------------------------------
    // Light the lantern scatters toward the eye from the water IN FRONT of this
    // fragment -- added after the extinction, because it is born along the path. A
    // fragment in front of the flame therefore gets only the near half of the glow and
    // stands out against the full glow behind it. One uniform compare when both slots
    // are off (every frame the eye is in air).
    if ( abyssaLampA.w + abyssaLampB.w > 0.0 ) {
      vec3 lrv = vFogP - cameraPosition;
      float lL = length( lrv );
      c += lampAirlight( cameraPosition, lrv / max( lL, 1e-4 ), lL );
    }

    // The air leg. Skipped outright when the ray never leaves the water, which is every
    // frame the game itself renders -- so the underwater path pays nothing for the sky,
    // not even the three exp() this costs, and c is left byte-identical.
    if ( La > 0.0 ) {
      vec3 trA = exp( -La * KAIR );
      vec3 A   = airLight( fogColor );
      // THE HAZE TAKES THE SKY BEHIND IT (atmos track). airLight is the HORIZON's
      // radiance, which is right for a ray at the horizon and wrong above it: a far
      // island or ridge rising a few degrees into the sky settled on the horizon white
      // while the sky right behind it had already darkened toward the zenith, so the land
      // drew as a pale flat cut-out standing on the sea (measured on the noon and dusk
      // deck frames). The in-scatter along a long air path converges on the sky seen IN
      // THAT DIRECTION, so the airlight here follows the dome's own elevation gradient
      // (the same 1 - (1 - up)^5 blend and the same 3.4-degree horizon ease skyDome
      // applies), and a distant ridge fades INTO the sky behind it instead of past it.
      // abyssaAirZ.a = 0 on any program never handed the uniform: horizon only, as before.
      // Below the horizon up = 0 and this is exactly airLight, so the sea, the ocean rim
      // and the dome's lower half keep the one shared number they meet on.
      if ( abyssaAirZ.a > 0.0 ) {
        float aup = clamp( ( vFogP.y - cameraPosition.y ) / max( vFogDepth, 1e-3 ), 0.0, 1.0 );
        float ahz = 1.0 - aup; ahz *= ahz; ahz *= ahz * ( 1.0 - aup );
        vec3 As = mix( A, abyssaAirZ.rgb, 1.0 - ahz );
        A = mix( As, A, ( 1.0 - smoothstep( 0.0, 0.060, aup ) ) );
      }
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
// x = ambient share for the grit (1 in the lit shallows, falls with the water's radiance)
const uSnowAmb = { value: new THREE.Vector3(1, 0, 0) };
// Snow character per zone (see the snow vertex shader): fall clock, drift clock, size
// gain, drift throw. Clocks are integrated here so a zone blend never jumps the field.
const uSnowZone = { value: new THREE.Vector4(0, 0, 1, 1) };
//                 fall  drift  size  throw
const SNOW_ZONE = [[1.00, 1.00, 1.00, 1.00],    // zone 0: the shipped grit
                   [0.35, 1.90, 0.85, 1.60],    // zone 1: hot water rises -- grit hangs and swirls
                   [0.45, 0.55, 1.90, 0.70]];   // zone 2: big, slow flocs of true marine snow
let _snowT = -1;
const uPixP = { value: 900 };
const _ambP = { r: 0, g: 0, b: 0 };   // pixel scale for particulate.js, refreshed per frame
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
const uStormU = { value: 0 };
// --- THE RAFT'S SHADOW ON THE SEA. The surface samples the sun's own shadow map
// (lighting.js: an 18-unit ortho box over the raft, PCFShadowMap, so the depth texture
// carries a COMPARE function and must be read through a sampler2DShadow — reading it
// through a plain sampler2D is GL_INVALID_OPERATION at draw on WebGL2, the exact class
// of error this file's history is made of). uShadowK is the gate: 0 whenever the map is
// off (castShadow false below y = -26 / degrade tier / fog morning) or not yet rendered,
// and the fallback texture bound then is a tiny cleared depth target of this file's
// own that ALSO carries a compare function, so the sampler's binding is always valid.
const uSunShadow = { value: null };
const uSunShadowMat = { value: new THREE.Matrix4() };
const uShadowK = { value: 0 };
let shadowFallbackRT = null;
function buildShadowFallback() {
  const dt = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType);
  dt.format = THREE.DepthFormat;
  dt.compareFunction = THREE.LessEqualCompare;
  dt.minFilter = THREE.LinearFilter; dt.magFilter = THREE.LinearFilter;
  shadowFallbackRT = new THREE.WebGLRenderTarget(4, 4, { depthTexture: dt, depthBuffer: true });
  // Clear once: depth 1.0 everywhere = "nothing in front of anything" = fully lit.
  renderer.setRenderTarget(shadowFallbackRT);
  renderer.clear();
  renderer.setRenderTarget(null);
  uSunShadow.value = dt;
}
function updateSunShadow() {
  const map = sun.castShadow ? sun.shadow.map : null;
  const dt = map ? map.depthTexture : null;
  if (dt && dt.compareFunction) {
    uSunShadow.value = dt;
    uSunShadowMat.value.copy(sun.shadow.matrix);
    uShadowK.value = clamp((sun.intensity - 0.15) / 0.6, 0, 1);
  } else {
    uSunShadow.value = shadowFallbackRT.depthTexture;
    uShadowK.value = 0;
  }
}
// --- SKY DRAMA uniforms. Shared by the dome and the sea exactly the way uSky*/uSun*
// are: skyRadiance() is ONE function compiled into both, so both must be handed the
// same objects or the sky over the horizon and the sky in Snell's window drift apart.
// Every one of them is written in updateWater's existing single pass — there is no
// second update path and nothing here allocates.
const uCloudDrift = { value: new THREE.Vector2() };   // CPU-integrated wind advection
const uCloudScale = { value: GLASS.cloud.scale };
const uCloudCov = { value: 0.16 };
const uCloudSoft = { value: GLASS.cloud.softCalm };
const uCloudTex = { value: 0.3 };
const uCloudLit = { value: new THREE.Vector3() };
const uCloudBase = { value: new THREE.Vector3() };
// Cloud SHAPING, packed so the two shaders gain two vec4s and one float rather than
// nine scalars. Everything storm- or coverage-dependent in here is resolved on the CPU
// in skyDrama, so the shader reads them straight.
//   uCloudIsl = (island uv scale, gate, gate softness, threshold swing)
//   uCloudShp = (ragged-edge uv scale, ragged amount, zenith bias, milky-band top)
const uCloudIsl = { value: new THREE.Vector4() };
const uCloudShp = { value: new THREE.Vector4() };
const uCloudBak = { value: 0 };                       // backlit amount, 0 noon .. 1 dusk
// Painted-dome cloud amount: 1 = the shipped painted sky, 0 = no painted cloud at all
// (world/clouds.js's instanced puffs own the sky instead). Resolved on the CPU in
// skyDrama from GLASS.cloud.dome and the storm envelope.
const uCloudDome = { value: 1 };
// Cloud FORM (the dimension pass), same packing discipline:
//   uCloudFrm  = (flank terminator width, height-proxy depth, shade amount, base amount)
//   uCloudFrm2 = (crown highlight, cauliflower detail)
// Every amount is storm-scaled to zero on the CPU, so the gale's flat lid is untouched.
const uCloudFrm = { value: new THREE.Vector4() };
const uCloudFrm2 = { value: new THREE.Vector2() };
const uSunUV = { value: new THREE.Vector2() };        // cloud-uv step toward the sun
const uDiscK = { value: 1 };                          // fog eats the disc (and the glitter)
const uMoonDir = { value: new THREE.Vector3(0, 1, 0) };
const uMoonRight = { value: new THREE.Vector3(1, 0, 0) };
const uMoonCol = { value: new THREE.Vector3() };
const uMoonR = { value: GLASS.moon.radius };
const uMoonPh = { value: new THREE.Vector4(1, 0, GLASS.moon.earthshine, GLASS.moon.halo) };
const uFog = { value: 0 };
const uFogCol = { value: new THREE.Vector3() };
// One declaration block, injected into both fragment shaders so the two can never
// disagree about what skyRadiance/airFog need.
export const GLSL_SKY_DECL = `uniform vec2 uCloudDrift, uSunUV, uCloudFrm2;
uniform float uCloudScale, uCloudCov, uCloudSoft, uCloudTex, uCloudBak, uCloudDome, uDiscK, uMoonR, uFog;
uniform vec3 uCloudLit, uCloudBase, uMoonDir, uMoonRight, uMoonCol, uFogCol;
uniform vec4 uMoonPh, uCloudIsl, uCloudShp, uCloudFrm;`;
// The uniform map half of the same pairing.
export const SKY_UNIFORMS = {
  uCloudDrift, uCloudScale, uCloudCov, uCloudSoft, uCloudTex, uCloudLit, uCloudBase, uSunUV, uDiscK,
  uCloudIsl, uCloudShp, uCloudBak, uCloudDome, uCloudFrm, uCloudFrm2,
  uMoonDir, uMoonRight, uMoonCol, uMoonR, uMoonPh, uFog, uFogCol,
  abyssaAir: { value: AIR_U },
  abyssaStyle: { value: STYLE_U },
  abyssaBolt0: { value: BOLT0_U }, abyssaBolt1: { value: BOLT1_U },
  abyssaBoltCol: { value: BOLT_COL_U }, abyssaBoltK: { value: BOLT_K_U }
};
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
      uSkyZen, uSkyHor, uSunCol, uSunDir: uSunDirU, uSunSize, uAir,
      uOcSea, uRough, uGlit, uSkyEnvT, uSkyEnvK, uCloudShT, uCloudShW,
      abyssaLampA: { value: LAMPA_U }, abyssaLampAC: { value: LAMPAC_U },
      abyssaLampB: { value: LAMPB_U }, abyssaLampBC: { value: LAMPBC_U },
      abyssaLampK: { value: LAMPK_U }, abyssaLampP: { value: LAMPP_U },
      abyssaOccA: { value: OCCA_U }, abyssaOccB: { value: OCCB_U },
      ...SKY_UNIFORMS,
      ...VOL_DOME_U
    },
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir;
      void main(){ vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        gl_Position = vec4( p.xy, p.w * 0.999999, p.w ); }`,
    fragmentShader: `uniform vec3 uSurf, uSunGlow; uniform float uReach, uTime;
      uniform vec3 uSkyZen, uSkyHor, uSunCol, uSunDir;
      uniform float uSunSize, uAir;
      ${GLSL_SKY_DECL}
      varying vec3 vDir;
      ${GLSL_NOISE}
      ${GLSL_AMBIENT}
      ${GLSL_WATER}
      ${GLSL_AIR}
      ${GLSL_SKY}
      uniform vec4 uOcSea, uRough; uniform vec2 uGlit;
      ${GLSL_SEA_SKY}
      ${GLSL_FARSEA}
      ${GLSL_VOL_DOME}
      ${GLSL_LAMP}

      // The far field on the AIR side. Below the horizon it is open sea at grazing
      // incidence — which is the reflected horizon sky closed by haze, i.e. the airlight
      // — and that is also what the fog chunk converges on at L -> infinity and what the
      // ocean disc fades into at its 460-unit rim. Three surfaces, one number, no ring.
      // Above the horizon, ease the last 3.4 degrees of sky into the same value: it costs
      // nothing in clear weather (skyRadiance already tends to uSkyHor there) and it is
      // what hides airLight's storm approximation.
      // BOTH smoothstep edges ASCEND. The inverted form is UNDEFINED in GLSL and produces
      // driver-dependent garbage — the same trap documented on nephParams.
      // The marine layer rides on top of the whole air-side answer, horizon included:
      // whiting the sky and leaving the airlight band clear is exactly the seam this
      // function exists to prevent.
      vec3 skyDome( vec3 d, vec3 hz ){
        // BELOW THE HORIZON, THE SEA GOES ON. The surface mesh stops at camera.far; past
        // it every wave is unresolved and the sea is the far-sea BRDF the surface itself
        // eases into, hazed by the same air leg the fog chunk runs (view-depth based,
        // exactly as the chunk measures it), then the marine layer at full reach.
        if ( d.y < 0.0 ) {
          vec3 c = farSea( d, uSurf );
          float camH = max( cameraPosition.y - ${f(SURFACE_Y)}, 0.3 );
          vec3 fwd = -vec3( viewMatrix[ 0 ][ 2 ], viewMatrix[ 1 ][ 2 ], viewMatrix[ 2 ][ 2 ] );
          float La = camH / max( -d.y, 1e-4 ) * max( dot( d, fwd ), 0.05 );
          c = mix( hz, c, exp( -La * KAIR ) );
          return airFog( c, 0.0, 1.0 );
        }
        // THE VOLUMETRIC SKY (world/sky.js): atmosphere LUT + marched clouds + disc,
        // easing into the same airlight over the last 1.3 degrees instead of 3.4 (the
        // airlight IS the physical horizon now, so the ease has nothing left to hide).
        if ( uVolK.x > 0.5 )
          return airFog( mix( volSky( d ), hz, 1.0 - smoothstep( 0.0, 0.022, d.y ) ), d.y, 1.0 );
        return airFog( mix( skyRadiance( d ), hz, 1.0 - smoothstep( 0.0, 0.060, d.y ) ),
                       d.y, 1.0 );
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
        // The lamp's glow on rays that hit nothing: the same closed form the fog chunk
        // runs, with the segment open to infinity (atan saturates, nothing diverges), so
        // the glow is continuous across every silhouette against open water.
        if ( abyssaLampA.w + abyssaLampB.w > 0.0 ) c += lampAirlight( cameraPosition, d, 1.0e4 );
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
  buildSkyEnv();
}

// ---------------------------------------------------------------------------
// SKY ENVIRONMENT MAP (M3). The raft's brass and timber had no sky to reflect:
// scene.environment was never set and every metal leaned on the static
// RoomEnvironment from core.js. This renders the SKY DOME ALONE — a minimal temp
// scene holding a second mesh on the dome's own geometry+material, so no water, no
// terrain, no props ever land in the capture — through a tiny CubeCamera, runs it
// through PMREMGenerator, and hands the result to whoever registered via onSkyEnv().
// Deliberately SCOPED (per-material envMap on the raft, never scene.environment):
// every underwater material — leviathan brass, the diver's helmet, wreck fittings —
// keeps the neutral RoomEnvironment, so the deep can never pick up sky glints
// through the fog-patched materials at -500.
// Refresh is driven by the PALETTE, not the clock: a capture happens only when
// _pHor/_pZen have drifted past a threshold since the last one (ring-stop
// transitions, storm onset, fog mornings), throttled to one every 2.5 s. A stable
// noon sky costs six float comparisons a frame and nothing else.
let envScene = null, envCam = null, envCubeRT = null, envPM = null, envRT = null;
const envListeners = [];
const _envFinger = [9, 9, 9, 9, 9, 9];   // impossible values force the first capture
let envCool = 0;
export function onSkyEnv(fn) { envListeners.push(fn); if (envRT) fn(envRT.texture); }
function buildSkyEnv() {
  envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(dome.geometry, dome.material));
  envCubeRT = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType });
  envCam = new THREE.CubeCamera(0.1, 10, envCubeRT);
  envPM = new THREE.PMREMGenerator(renderer);
}
function captureSkyEnv() {
  // uAir is forced to 1 for the capture so the dome renders its pure-sky branch: the
  // raft lives at the surface and its reflections are the sky, no matter how deep the
  // PLAYER's camera happens to be when a palette transition lands.
  const prevAir = uAir.value, prevDisc = uDiscK.value;
  uAir.value = 1;
  // The disc is left OUT of the capture: on the sea it is the glitter lobe's job (GGX on
  // the spectrum's roughness), and a blurred disc in the prefiltered sky would draw it
  // twice. The raft's metal takes its sun from the real key light.
  uDiscK.value = 0;
  volCaptureMode(true);
  envCam.update(renderer, envScene);
  volCaptureMode(false);
  uAir.value = prevAir; uDiscK.value = prevDisc;
  const old = envRT;
  envRT = envPM.fromCubemap(envCubeRT.texture);
  if (old) old.dispose();
  for (let i = 0; i < envListeners.length; i++) envListeners[i](envRT.texture);
  _seaEnvDome = envRT.texture; applySeaEnv();
  _envFinger[0] = _pRing[0]; _envFinger[1] = _pRing[1]; _envFinger[2] = _pRing[2];
  _envFinger[3] = _pZen[0]; _envFinger[4] = _pZen[1]; _envFinger[5] = _pZen[2];
  envCool = 2.5;
}
function maybeRefreshSkyEnv(dt) {
  if (!envCam) return;
  envCool -= dt;
  if (envCool > 0) return;
  const d = Math.abs(_pRing[0] - _envFinger[0]) + Math.abs(_pRing[1] - _envFinger[1])
          + Math.abs(_pRing[2] - _envFinger[2]) + Math.abs(_pZen[0] - _envFinger[3])
          + Math.abs(_pZen[1] - _envFinger[4]) + Math.abs(_pZen[2] - _envFinger[5]);
  if (d > 0.030) captureSkyEnv();
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
    // ONE draw call, not two. Since r163 three renders a transparent DoubleSide material
    // in two passes (back faces, then front) unless this is set. These ray cards are
    // additive billboards that shade identically on both faces, so the second pass
    // buys nothing but a submission.
    forceSinglePass: true,
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
        // REVERSED-EDGE smoothstep is UB in GLSL and evaluates to 0 on this driver,
        // which zeroed vFade and killed the entire billboard system for every frame it
        // ever shipped. Same idiom as foldK below: 1.0 - smoothstep(lo, hi, x).
        vFade = uFade
          * ( 1.0 - smoothstep( ${f(RAY_L * 0.30)}, ${f(RAY_L * 0.5)}, dist ) )   // hides the wrap boundary
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
    uColA: { value: new THREE.Vector3(...colA) }, uColB: { value: new THREE.Vector3(...colB) },
    // Lit by the lantern slot the fog chunk's in-scatter reads (see GLSL_LAMP), and by
    // the water's own ambient at the camera: in the dark zones the grit is invisible
    // until the flame reaches it, which is the whole look.
    abyssaLampA: { value: LAMPA_U }, abyssaLampAC: { value: LAMPAC_U }, abyssaLampB: { value: LAMPB_U }, abyssaLampBC: { value: LAMPBC_U }, uAmb: uSnowAmb, uZone: uSnowZone,
    // The vents' warm columns: the SAME Float32Array vents.js fills per reseed (flat
    // xyzr per vent; three uploads a flat typed array as-is, no per-frame flatten) and
    // the same count object, so the snow can never disagree with the chimneys.
    uVentCols: { value: ventColumns }, uVentN: ventColumnCount
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `uniform vec3 uCam, uLightPos, uColA, uColB, uAmb;
      uniform vec4 abyssaLampA, abyssaLampAC, abyssaLampB, abyssaLampBC, uZone;
      uniform float uTime, uL, uSize, uAlpha, uFall, uPix, uExtG, uDepth, uExtK;
      uniform vec4 uVentCols[${VENT_COLS_MAX}];
      uniform int uVentN;
      attribute vec3 aSeed;
      varying float vA; varying vec3 vC;
      void main(){
        vec3 p = position;
        // DEPTH IDENTITY (uZone, integrated on the CPU so a zone change never makes the
        // field jump): x = the fall clock, y = the drift clock, z = size gain, w = drift
        // throw. Zone 0 = the shipped motion; the boiler room's grit barely sinks and
        // swirls on the vent currents; the abyss snows in big, slow, rare flakes.
        p.y -= uZone.x * uFall * ( 0.45 + aSeed.y );
        p.x += sin( uZone.y * 0.21 + aSeed.z * 39.0 ) * 1.7 * uZone.w;
        p.z += cos( uZone.y * 0.17 + aSeed.z * 23.0 ) * 1.7 * uZone.w;
        vec3 w = mod( p - uCam + uL * 0.5, uL ) - uL * 0.5 + uCam;
        // WARM COLUMNS. Marine snow SINKS; the water over an active throat RISES, so
        // a column above each vent carries far less grit than the cold water round
        // it, and what grit is in it is going up. The column is a cylinder off the
        // throat top, radius widening with height, dying out by ~25 units (the
        // shimmer stream runs 22). One compare gates the whole thing above the vent
        // field (zone 1 floors at -340 and below), so zone 0 and the surface pay one
        // branch per vertex and nothing else; the loop is bounded by the live count.
        float warm = 0.0;
        if ( uVentN > 0 && w.y < -280.0 ) {
          for ( int i = 0; i < ${VENT_COLS_MAX}; i++ ) {
            if ( i >= uVentN ) break;
            vec4 v = uVentCols[ i ];
            float h = w.y - v.y;
            if ( h < -1.0 || h > 26.0 ) continue;
            float r = v.w + h * 0.07;
            float k = ( 1.0 - smoothstep( r * 0.5, r, distance( w.xz, v.xz ) ) )
                    * smoothstep( -1.0, 1.5, h ) * ( 1.0 - smoothstep( 17.0, 26.0, h ) );
            warm = max( warm, k );
          }
        }
        // Rise phase: carried up ~5 units then gone (alpha reaches ~0 before the phase
        // wraps, so the wrap is never seen). Snow outside every column: warm = 0,
        // bit-identical to before.
        float ph = fract( uTime * 0.06 * ( 0.6 + aSeed.y ) + aSeed.x * 7.0 );
        w.y += warm * ph * 5.0;
        float warmA = 1.0 - warm * ( 0.75 + 0.25 * ph );
        vec4 mv = viewMatrix * vec4( w, 1.0 );
        float dist = -mv.z;
        gl_PointSize = clamp( ( 0.25 + aSeed.x * aSeed.x * 2.0 * uZone.z ) * uSize * uPix / max( dist, 0.4 ), 0.7, 22.0 )
                     * ( 1.0 - 0.35 * warm );
        // THE LANTERN PICKING GRIT OUT OF THE DARK. The same inverse-square and range
        // window the fog chunk's lamp in-scatter uses, with a forward glint: a flake
        // between the flame and the lens catches it hardest, as real snow does.
        vec3 dl = w - abyssaLampA.xyz;
        float dl2 = dot( dl, dl );
        float lq = dl2 / max( abyssaLampAC.w * abyssaLampAC.w, 1.0 );
        float lw = clamp( 1.0 - lq * lq, 0.0, 1.0 );
        float lE = abyssaLampA.w * lw * lw / max( dl2, 0.8 );
        float lmu = dot( dl * inversesqrt( max( dl2, 1e-4 ) ), normalize( uCam - w ) );
        float lb = lE * ( 0.35 + 1.5 * pow( 0.5 + 0.5 * lmu, 3.0 ) );
        vA = uAlpha * uDepth
           // Marine snow is water-borne. The wrap box follows the camera, so an eye at
           // the surface used to fill the AIR with drifting grit. Exactly 1.0 for
           // w.y <= 0, so nothing below the waterline changes by a bit.
           * ( 1.0 - smoothstep( 0.0, 0.9, w.y ) )
           // Reversed-edge smoothstep is GLSL UB (x0 on this driver) — it zeroed vA
           // and killed both snow layers. Fix idiom: 1.0 - smoothstep(lo, hi, x).
           * ( 1.0 - smoothstep( uL * 0.32, uL * 0.5, length( w - uCam ) ) )
           * smoothstep( 0.5, 3.0, dist )
           * exp( -dist * uExtG * uExtK )
           * warmA;
        // Ambient share follows the water's own radiance at the camera (uAmb, 1 in the
        // bright shallows, ~0.05 on the zone-2 floor), so the deep reads BLACK between
        // lit flakes instead of a uniform starfield; the flame's share is warm.
        // THE SECOND LAMP IN THE GRIT: slot B (a sleeper's body glow, the hoard, a lit ward,
        // the vent throat) picks flakes out of the dark round ITSELF, so a thing passing in
        // the murk carries a drifting cloud of lit motes that parallax against the black --
        // the water showing its volume. Same falloff and window; no glint (the source is
        // rarely between flake and lens). The gain folds lampGainB's ratio back out so a
        // B light of intensity I lights grit as a lantern of intensity I would.
        float bB = 0.0;
        if ( abyssaLampB.w > 0.0 ) {
          vec3 db = w - abyssaLampB.xyz;
          float db2 = dot( db, db );
          float bq = db2 / max( abyssaLampBC.w * abyssaLampBC.w, 1.0 );
          float bw = clamp( 1.0 - bq * bq, 0.0, 1.0 );
          bB = abyssaLampB.w * 0.09 * bw * bw / max( db2, 0.8 );
        }
        vC = mix( uColA, uColB, aSeed.z ) * ( 0.45 * uAmb.x ) + abyssaLampAC.rgb * ( 0.32 * lb ) + abyssaLampBC.rgb * ( 0.32 * bB );
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
  // fr 170 -> 135: at 170 the 27 u component was still at part strength where the log
  // rings sample it under 4 verts/wavelength, and a gale showed crawling mid-distance
  // aliasing; 135 retires it while the mesh still resolves it. Calm is untouched —
  // the fade CURVE is the same, it just completes sooner.
  [27.0, -11, 0.100, 0.340, 135],
  [17.0, 67, 0.050, 0.175, 110],
  [11.0, -38, 0.022, 0.082, 70],
  [6.5, 91, 0.010, 0.036, 45]
];
const DISP = Math.sqrt(9.81 / 3);   // k is per world unit and a unit is 3 m: omega = sqrt(g*k/3)

// ---------------------------------------------------------------------------
// WIND ON THE WATER — the field obeys the day hand's wind.
// ---------------------------------------------------------------------------
// This is a BIAS on the spectrum above, not a second ocean. Each component keeps its
// wavelength, its dispersion-correct speed and its retirement radius; what the wind
// changes is (a) the component's BEARING, dragged part-way onto the wind axis, and
// (b) how the amplitude is distributed across the spread — energy onto the components
// already pointing downwind, away from the ones lying across it.
//
// At uWindS = 0 every one of those terms is an exact identity: mix(d0, ..., 0) is d0,
// d0 is already unit so normalize() is a no-op, and both amplitude factors are 1. Calm
// windless noon therefore renders the shipped field bit-for-bit. That is the anchor.
//
// The direction is carried as a VECTOR, not an angle, and eased on the CPU (see
// updateWater): a new bearing re-aims the chop over ~15 s instead of snapping, and a
// vector lerp needs no wrap handling. A 180-degree reversal passes near zero length on
// the way, which reads as the wind dropping and rebuilding on the new bearing — which
// is what actually happens.
const uWindD = { value: new THREE.Vector2(1, 0) };   // eased unit bearing (x, z)
const uWindS = { value: 0 };                          // eased speed 0..1
const uWindK = { value: new THREE.Vector2(GLASS.windwater.anisoK, GLASS.windwater.ampK) };
const uCap = { value: new THREE.Vector2(GLASS.windwater.capThr, GLASS.windwater.capK) };
// THE CHOP. (k, foamThr, foamSoft, foamK) and (texScale, streakK, scatterK, scatterPow).
// Both refreshed from GLASS.chop every frame in updateWater, so the whole block is
// live-pokeable from the console like the rest of the glass.
const uChop = { value: new THREE.Vector4(GLASS.chop.k, GLASS.chop.foamThr, GLASS.chop.foamSoft, GLASS.chop.foamK) };
const uChop2 = { value: new THREE.Vector4(GLASS.chop.texScale, GLASS.chop.streakK, GLASS.chop.scatterK, GLASS.chop.scatterPow) };
// Weights of the three lagged compression samples. exp(-tau/foamDecay), resolved on the
// CPU so foamDecay stays a live knob (the LAG TIMES themselves are compile-time — they
// set the per-component phase-rotation constants baked into the shader).
const uLagW = { value: new THREE.Vector3(1, 1, 1) };
// (streakLegacy, foamLagK). The first scales the OLD wind-streak block; the second scales
// the three lagged foam samples against the live one, i.e. how much lingering foam there
// is relative to freshly-born foam.
const uChopX = { value: new THREE.Vector2(GLASS.chop.streakLegacy, GLASS.chop.foamLagK) };

// SURFACE BOIL. One externally-driven boil site (x, z, amp, radius) — the patch of sea
// Sal's exhaust breaches. Fed by surfaceBoil() (diver.js calls it as each bubble dies
// into the swell), decays in updateWater over ~1.5 s. Zero new draw calls: it rides the
// surface shader as a foam patch + expanding ripple rings, and reads from BOTH sides of
// the interface (the deck looking down and Sal looking up see the same boil).
const uBoil = { value: new THREE.Vector4(0, 0, 0, 1.4) };
// STORM SWELL SCALE — GLASS.chop.galeAmp. See galeAmt() in GLSL_CHOP_DECL.
const uGale = { value: GLASS.chop.galeAmp };
// BROAD-BODY SSS. (sssK, sssPow, sssTau, sssGain) and (sssCap, sssCalm, dayLo, dayHi).
const uSss = { value: new THREE.Vector4(GLASS.chop.sssK, GLASS.chop.sssPow, GLASS.chop.sssTau, GLASS.chop.sssGain) };
const uSss2 = { value: new THREE.Vector4(GLASS.chop.sssCap, GLASS.chop.sssCalm, GLASS.chop.sssDayLo, GLASS.chop.sssDayHi) };
// CHURNED-WATER OPACITY. (opaqK, opaqLo, opaqHi, opaqFoam) and (opaqBelow, opaqSssK).
// See the GLASS.chop.opaq* block: this scales the WEIGHT of the screen-space refraction,
// it never touches the pass itself. At storm 0 wind 0 every term is exactly 0.
// DEV DECOMPOSITION. uDbg = 0 is the shipped composite (one uniform compare per
// fragment, nothing else). 1 reflection, 2 analytic body, 3 screen-space transmission,
// 4 foam (all whitewater mixes), 5 broad-body SSS, 6 haze/airlight, 7 bubble lift
// (accumulator), 8 sun glitter. Air side only; the from-below path ignores it.
// window.__sky.dbg(n).
const uDbg = { value: 0 };
const uOpaq = { value: new THREE.Vector4(GLASS.chop.opaqK, GLASS.chop.opaqLo, GLASS.chop.opaqHi, GLASS.chop.opaqFoam) };
const uOpaq2 = { value: new THREE.Vector2(GLASS.chop.opaqBelow, GLASS.chop.opaqSssK) };
// SPILLING BREAKERS. (spillK, spillLen, spillLip, spillTail).
const uSpill = { value: new THREE.Vector4(GLASS.chop.spillK, GLASS.chop.spillLen, GLASS.chop.spillLip, GLASS.chop.spillTail) };
// SURFACE FILTERING (roadmap/ref-surface-filtering.md). uRipple is the baked 1024^2
// ripple normal (lib/textures.js). uDet = (detailK, gain0, gainWind, belowK): the
// detail-normal master, its calm gain, its per-m/s wind gain, and the fraction of it the
// from-below normal is allowed. uRough = (windMps, roughK, glitterLegacy, glitterK): the
// 0..1 wind -> m/s scale for Cox-Munk, the roughness master, the legacy pow() glitter
// A/B switch and the GGX glitter gain. uGlit = (discHalfAngle, discOmega): the painted
// sun disc's half-angle (widens the GGX lobe) and its integrated solid angle (the
// energy the lobe is normalised to, so the GGX path never carries more light than the
// pow() disc it replaces). Both are derived from uSunSize on the CPU each frame.
const uRipple = { value: null };
const uDet = { value: new THREE.Vector4(GLASS.chop.detailK, GLASS.chop.detailGain, GLASS.chop.detailWind, GLASS.chop.detailBelow) };
const uRough = { value: new THREE.Vector4(GLASS.chop.windMps, GLASS.chop.roughK, GLASS.chop.glitterLegacy, GLASS.chop.glitterK) };
const uGlit = { value: new THREE.Vector2(0.0445, 0.009) };
// FOAM ACCUMULATOR (roadmap/ref-foam-accumulator.md). uFoamAcc is the live side of a
// 256^2 ping-pong target tiled over ACC_TILE world units around the camera (see
// updateFoamAcc). uAccA = (invTile, accK, fadeR, bubbleK); uAccC = the camera xz the
// window is centred on; uAccS = (foamStretch, laceScale, 0, 0).
const uFoamAcc = { value: null };
const uAccA = { value: new THREE.Vector4(1 / 120, GLASS.chop.foamAccK, 58, GLASS.chop.bubbleK) };
const uAccC = { value: new THREE.Vector2(0, 0) };
const uAccS = { value: new THREE.Vector2(GLASS.chop.foamStretch, 0.55) };
const CHOP_LAGS = [1.35, 2.70, 4.05];
// Eased CPU state. Module-scoped, zero allocation per frame.
let _wdX = 1, _wdZ = 0, _wsp = 0;
// Targets, written by setWeatherHand (or the dev override) and chased in updateWater.
let _wdTX = 1, _wdTZ = 0, _wspT = 0;
// Time constant of the re-aim. tau 5.5 s puts a 90-degree swing 95% home in ~16 s,
// which is the card's "over seconds, not on the frame".
const WIND_TAU = 5.5;
// Dev override: game.js pushes the real wind every frame, so poking the stored object
// is not enough to force a sweep. window.__sky.wind(s, dirRad) / .windOff().
let _wForce = null;
// Declared inside the wave GLSL so both the vertex and the fragment copy see them; the
// two are compiled into one program, which is exactly what a shared uniform is for.
const GLSL_WIND_DECL = `uniform vec2 uWindD, uWindK; uniform float uWindS;`;

// THE CPU ANSWER TO "HOW HIGH IS THE SEA HERE". The spectral ocean (world/ocean.js)
// owns it: a worker inverse-FFTs the identical long-wave bins the GPU draws, ahead of
// the clock, and the main thread interpolates them (see ocean.worker.js). The storm argument is kept for the callers'
// signature -- the field already carries the weather.
export function surfaceHeightAt(x, z, t, storm) {
  return oceanHeightAt(x, z, t);
}
// Raft hull collar for the surface shader: centre xz, half-size, |heave rate|.
const uRaftC = { value: new THREE.Vector4(0, 0, 4.7, 0) };
export function setRaftContact(x, z, half, vy) { uRaftC.value.set(x, z, half, Math.min(1.5, Math.abs(vy))); }
const uSeaEnv = { value: null }, uEnvK = { value: 1 }, uFarR = { value: 700 };
// 0 = eye fully in water, 1 = fully in air. The band is half a helmet: narrow enough that
// the transition is a moment, wide enough not to alias on a chopping surface.
const AIR_BAND = 0.35;
const uAir = { value: 0 };
// The live surface height under the camera, refreshed once per frame in updateWater.
// game.js clamps the play camera against THIS rather than a flat SURFACE_Y, so the
// clamp sits below the air band even in a gale (a storm trough reaches about -0.6, which
// against a flat -0.9 clamp would have leaked a little sky into the underwater frame).
// The resolved low-frequency wave field, for the seabed caustics (terrain.js reads it
// in updateTerrain): [dx, dz, k, ampH, w] x 2 longest components, then t. Written once a
// frame in updateWater right after surfaceHeightAt resolves _cw.
export const waveLow = new Float32Array(11);
let _surfH = SURFACE_Y;
export function localSurfaceY() { return _surfH; }
// The storm value the water mesh itself is rendered with — for callers (the raft)
// that need surfaceHeightAt to agree with the mesh, not with their own copy of storm.
export function stormLevel() { return uStormU.value; }

// Inject boil at a breach point. Site follows the latest call (Sal's column is one
// place); strength ACCUMULATES so a dense burst boils harder than a stray trickle,
// and updateWater decays it. Radius breathes with the accumulated strength.
export function surfaceBoil(x, z, strength) {
  const b = uBoil.value;
  const amp = Math.min(1.6, b.z + strength);
  b.set(x, z, amp, 0.9 + 0.6 * Math.min(1, amp));
}
// debug surface (kept, like window.pred / window.__helm)
if (typeof window !== 'undefined') window.__boil = () => uBoil.value;


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
// True while the pass is being skipped for churn opacity (see renderRefraction). Forces
// one fresh render on the frame the window re-opens instead of showing a stale target.
let refrSkipped = false;

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
// The upgrade path (postfx.restoreQuality): back to the half-res target. Only undoes
// reduceRefraction — the full shed (degradeRefraction) is the ladder's terminal rung.
export function restoreRefraction() {
  if (refrShift === 1) return;
  refrShift = 1;
  if (refrRT) { refrRT.dispose(); refrRT = null; }
}

// Called by game.js once per frame, after updateWater (needs _surfH/uAir) and before
// the composer render. Renders the far side of the interface into refrRT.
// Meshes that must sit OUT of the refraction render. Pushed by their own module at
// build; a fixed handful, walked twice per pass (and the pass runs at half rate).
export const refrHide = [];
const _hidWas = [];

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
  // The side the hysteresis WILL settle on this frame, resolved before anything can
  // return early. It has to be first: the churn skip below reads it, and an early
  // return that leaves `refrAir` stale would freeze the pass on the wrong side — a
  // measured bug, the diver swam under a gale and the below-side window never came
  // back because the skip kept answering with the AIR side's weight.
  const sideNow = refrAir ? (uAir.value >= 0.30) : (uAir.value > 0.70);

  // CHURN SKIP — the opacity fix pays for itself. Once the shader's transmission
  // weight has reached zero (a full gale closes the window completely from the air;
  // see the GLASS.chop.opaq* block), the target this pass fills is multiplied by 0 in
  // every fragment, so submitting the whole scene a second time buys literally nothing.
  // Uses the GLOBAL part of opq only — the local foam term can only push opq HIGHER,
  // so skipping when the global part is already saturated is conservative. The BELOW
  // side carries opaqBelow (0.35), so it effectively never saturates and the diver's
  // window is never skipped away.
  // Re-enable is seamless by construction: the weight ramps back through 0, so the
  // first frames after the skip weigh a possibly-stale target at ~0 anyway; even so
  // the stale frame is forced fresh (refrSkipped bypasses the temporal skip below).
  {
    const CH = GLASS.chop;
    const churn = ms(Math.max(uStormU.value, uWindS.value), CH.opaqLo, CH.opaqHi);
    const w = CH.opaqK * churn * (sideNow ? 1 : CH.opaqBelow);
    if (w >= 0.995) { uRefrK.value = 0; refrSkipped = true; refrAir = sideNow; return; }
  }

  if (sideNow === refrAir && !refrSkipped && refrFrame % (refrShift === 1 ? 2 : 3) !== 0) return;
  refrSkipped = false;

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
  // Objects that are in the AIR and are not clipped by the plane (a plain ShaderMaterial
  // does not honour clippingPlanes unless its own source carries the clipping chunks).
  // The puff clouds DO belong in this render — the sky through Snell's window is real
  // sky. Falling rain does not: the air half is never the half this pass keeps.
  for (let i = 0; i < refrHide.length; i++) {
    _hidWas[i] = refrHide[i].visible; refrHide[i].visible = false;
  }
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
  // THE DOME DRAWS THE FAR SIDE'S MEDIUM. It is not clipped (a plain ShaderMaterial),
  // so it lands in every texel no geometry covers -- and it picks sky or water from uAir,
  // i.e. from the CAMERA's side. From the deck that painted open SKY into the target
  // wherever the transmitted ray found no terrain, and the sea showed a white, sky-
  // coloured blob standing on the horizon with the far seabed ridges cut out of its
  // lower edge (measured on the noon deck frame, P-bypass too). A ray that has crossed
  // the interface is in the other medium, so for this one render the dome is told so.
  const airWas = uAir.value;
  uAir.value = air ? 0 : 1;
  renderer.render(scene, camera);
  uAir.value = airWas;
  renderer.setRenderTarget(prevRT);
  renderer.clippingPlanes = [];
  renderer.shadowMap.autoUpdate = prevShadow;
  renderer.setClearColor(_prevClear, prevAlpha);
  for (let i = 0; i < refrHide.length; i++) refrHide[i].visible = _hidWas[i];
  surface.visible = true;

  uRefr.value = refrRT.texture;
  // Fade the whole effect out over the last 10 units of its depth range so it never
  // pops on the gate; analytic underneath is continuous.
  uRefrK.value = clamp((camera.position.y + 35) / 10, 0, 1);
}

// ---------------------------------------------------------------------------
// THE FAR SEA — one BRDF, shared by the surface's far band and the dome below the
// horizon, so the sea runs past camera.far to the true horizon with no seam.
// ---------------------------------------------------------------------------
// Past the last resolved wave every slope the spectrum carries is unresolved, so the
// sea there IS a microfacet surface with roughness sqrt(total mss) (Bruneton et al.'s
// geometry-to-BRDF hand-off). Two consequences drive the far look, and both are why
// the old horizon was a white band:
//   * the facets a grazing eye actually SEES are the ones tilted toward it, so the
//     mean reflected ray climbs above the horizon by ~ the slope spread: the far sea
//     reflects sky from a few degrees UP (bluer, darker than the horizon ring), not
//     the horizon ring itself;
//   * Fresnel is averaged over those facets, so it stops short of 1.0 at grazing.
// The result is the real horizon: a sea darker than the sky directly above it, a
// clean line where they meet, and the sun's glitter path running all the way to it.
// uOcSea = (Hs u, total mss, peak wavelength u, sea state). Needs GLSL_SKY + uSunDir,
// uSunCol, uDiscK, uRough, uGlit in scope.
// THE REAL SKY ON THE SEA (world/sky.js getSkyEnv / getCloudShadow). When the volumetric
// sky is up the sea reflects ITS environment -- sky + marched clouds + aureole, no disc --
// and the sun glint is multiplied by the cloud transmittance toward the sun, so the
// glitter path goes out when a cloud crosses the sun. The cloud deck's top-down
// transmittance shadows the sea (glint, crest glow, foam light, body). Both fall back
// to the analytic painted sky when the volumetric sky is off. abyssaSkyEnv is
// sky.js's own lookup (its contract: dir.y < 0 clamps to the horizon row).
const uSkyEnvT = { value: null }, uSkyEnvK = { value: 0 };
const uCloudShT = { value: null }, uCloudShW = { value: new THREE.Vector4(0, 0, 4096, 0) };
const GLSL_SEA_SKY = `
uniform sampler2D uSkyEnvT, uCloudShT;
uniform float uSkyEnvK;
uniform vec4 uCloudShW;
vec4 abyssaSkyEnv( sampler2D t, vec3 dir ){
  vec3 d = normalize( vec3( dir.x, max( dir.y, 0.0 ), dir.z ) );
  return texture2D( t, vec2( atan( d.z, d.x ) / 6.28318531 + 0.5, sqrt( d.y ) ) );
}
// The environment is one level (no mips), so a rough facet's lobe is integrated by
// hand: four taps on a cross of half-width r about R. r = 0 is the plain lookup.
vec3 seaSkyEnvRough( vec3 R, float r ){
  if ( r < 0.01 ) return abyssaSkyEnv( uSkyEnvT, R ).rgb;
  vec3 t = normalize( cross( R, vec3( 0.0, 1.0, 0.0 ) ) + vec3( 1e-4 ) );
  vec3 b = cross( t, R );
  return 0.25 * ( abyssaSkyEnv( uSkyEnvT, R + t * r ).rgb + abyssaSkyEnv( uSkyEnvT, R - t * r ).rgb
                + abyssaSkyEnv( uSkyEnvT, R + b * r ).rgb + abyssaSkyEnv( uSkyEnvT, R - b * r ).rgb );
}
// rgb: sky along R without the disc; a: cloud transmittance toward R.
vec4 seaSky( vec3 R ){
  if ( uSkyEnvK > 0.5 ) return abyssaSkyEnv( uSkyEnvT, R );
  float gs = gSunK; gSunK = 0.0;
  vec3 c = skyRadiance( R );
  gSunK = gs;
  return vec4( c, gOcc );
}
float cloudSun( vec2 xz ){
  if ( uCloudShW.w < 0.5 ) return 1.0;
  return texture2D( uCloudShT, clamp( ( xz - uCloudShW.xy ) / uCloudShW.z + 0.5, 0.002, 0.998 ) ).r;
}`;
const GLSL_FARSEA = `
float oceanF( float c ){ return 0.020383 + 0.979617 * pow( 1.0 - c, 5.0 ); }
float ggxD( float NoH, float a ){
  float a2 = a * a;
  float d = ( NoH * a2 - NoH ) * NoH + 1.0;
  return a2 / max( 3.14159265 * d * d, 1e-8 );
}
float smithGGXCorrelated( float NoV, float NoL, float a ){
  float a2 = a * a;
  float gv = NoL * sqrt( NoV * NoV * ( 1.0 - a2 ) + a2 );
  float gl = NoV * sqrt( NoL * NoL * ( 1.0 - a2 ) + a2 );
  return 0.5 / max( gv + gl, 1e-6 );
}
// The sun on a microfacet sea. alpha is the unresolved roughness; the painted disc's
// half-angle widens the lobe and its solid angle normalises it (uGlit), and the soft
// cap 1 - exp(-x) means a pixel can never carry more than the mirror answer L * F.
vec3 seaGlitter( vec3 N, vec3 V, float alpha, float sh ){
  float NoL = dot( N, uSunDir );
  if ( NoL <= 0.0 ) return vec3( 0.0 );
  vec3 H = normalize( uSunDir - V );
  float NoH = max( dot( N, H ), 0.0 );
  float VoH = max( -dot( V, H ), 1e-4 );
  float NoV = max( -dot( V, N ), 1e-4 );
  float aP = min( alpha + uGlit.x, 1.0 );
  float D = ggxD( NoH, aP );
  float Vis = smithGGXCorrelated( NoV, max( NoL, 1e-4 ), alpha );
  float Fs = oceanF( VoH );
  float gx = uGlit.y * uRough.w * D * Vis * NoL;
  float occ = uSkyEnvK > 0.5 ? abyssaSkyEnv( uSkyEnvT, uSunDir ).a : gOcc;
  return uSunCol * ( uDiscK * occ * sh * Fs * ( 1.0 - exp( -gx ) ) );
}
// Reflected ray of a rough sea: lifted by the visible-facet tilt.
vec3 seaReflDir( vec3 V, vec3 N, float alpha ){
  vec3 R = reflect( V, N );
  R.y = max( R.y, 0.55 * alpha * ( 1.0 - abs( V.y ) ) + 0.004 );
  return normalize( R );
}
float seaFresnel( vec3 V, vec3 N, float alpha ){
  return oceanF( clamp( max( -dot( V, N ), 0.45 * alpha ), 0.0, 1.0 ) );
}
// The water body seen from far above at grazing incidence: the column's own deep
// colour, the same seaBody() grade the near surface uses.
vec3 farBody( vec3 surfIrr ){
  vec3 c = abyssaAmbient( surfIrr, -40.0 ) * 0.92;
  return mix( c, vec3( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) ), 0.35 ) * 0.46;
}
vec3 farSea( vec3 V, vec3 surfIrr ){
  float alpha = clamp( sqrt( uOcSea.y + 0.003 ), 0.04, 0.6 );
  vec3 N = vec3( 0.0, 1.0, 0.0 );
  float F = seaFresnel( V, N, alpha );
  vec3 R = seaReflDir( V, N, alpha );
  vec3 sk = uSkyEnvK > 0.5 ? seaSkyEnvRough( R, 0.9 * alpha ) : seaSky( R ).rgb;
  vec3 c = sk * F + farBody( surfIrr ) * ( 1.0 - F );
  c += seaGlitter( N, V, alpha, 1.0 );
  return c;
}`;

function buildSurface() {
  // uSkyZen/uSkyHor/uSunCol/uSunDir/uSunSize/uStorm + SKY_UNIFORMS are the module-scoped
  // the DOME also holds. Shared on purpose: the sky in Snell's window and the sky over
  // the horizon are the same sky, and sharing the uniform is the only way that stays true
  // without a second update path to keep in sync.
  const u = Object.assign(fogUniforms(), {
    uTime, uCam,
    uSunDir: uSunDirU, uSkyZen, uSkyHor, uSunCol, uSunSize, uStorm: uStormU,
    ...SKY_UNIFORMS,
    ...OCEAN_UNIFORMS,
    uFlash: { value: 0 },
    uMirrorK: { value: 1 }, uNearK: { value: 1 },
    uBright: { value: 1 }, uFade: { value: 1 }, uDbg, uAir,
    uRefr, uRefrK, uRefrSide, uRes,
    uWindD, uWindS, uCap, uChop2, uSss, uSss2,
    uOpaq, uOpaq2, uBoil, uDet, uRough, uGlit,
    uSunShadow, uSunShadowMat, uShadowK,
    uRaftC, uSeaEnv, uEnvK, uFarR, uSkyEnvT, uSkyEnvK, uCloudShT, uCloudShW
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: u, fog: true, side: THREE.DoubleSide,
    defines: {},
    vertexShader: `#include <fog_pars_vertex>
      ${OCEAN_GLSL_DISP}
      uniform vec2 uOcLevC[ ${GRID_LEVELS} ];
      uniform vec3 uCam;
      uniform float uAir;
      varying vec3 vW;
      // THE PARAMETER POINT. vW is where the vertex ENDS UP; vP0 is the point of the
      // wave field it came from (the FFT textures are indexed by it). Every wave
      // quantity the fragment wants -- slope, Jacobian, foam -- is a function of vP0;
      // world-space patterns (caustics, splash lattices, distance) read vW.
      varying vec2 vP0;
      varying vec2 vG;          // the UNMORPHED grid point, for the clipmap band discard
      varying float vH;         // wave height (filtered at this vertex's LOD)
      flat varying vec3 vHole;  // finer level's centre and half-extent (z < 0: none)
      void main(){
        // CLIPMAP. position = (i, level, j) in the level's own cells about its snapped
        // centre. Near each level's outer edge the vertices geomorph onto the next
        // level's grid (odd ones slide onto their even neighbour), so at the seam both
        // levels have the same vertices and -- because ocDisp is a pure function of the
        // parameter point -- the same displaced positions: no cracks, no T-junctions.
        int l = int( position.y + 0.5 );
        float s = uOcGrid.x * exp2( float( l ) );
        vec2 c = uOcLevC[ l ];
        vec2 p = c + position.xz * s;
        vG = p;
        float R = uOcGrid.y * s;
        vHole = l > 0 ? vec3( uOcLevC[ l - 1 ], 0.5 * R ) : vec3( 0.0, 0.0, -1.0 );
        vec2 dc = abs( p - c );
        float m = clamp( ( max( dc.x, dc.y ) / R - 0.70 ) / 0.22, 0.0, 1.0 );
        p -= fract( p / ( 2.0 * s ) ) * ( 2.0 * s ) * m;
        vec3 D = ocDisp( p, uCam.xz );
        vP0 = p;
        vH = D.y;
        vec3 w = vec3( p.x + D.x, ${f(SURFACE_Y)} + D.y, p.y + D.z );
        vW = w;
        vec4 mvPosition = viewMatrix * vec4( w, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        #ifdef USE_FOG
          // The eye-to-surface path lies in ONE medium. The fog chunk splits paths at a
          // flat y = 0, which with real swell would fog a trough seen from the deck as
          // if the last metres of the ray were underwater. Pin the fragment's height to
          // the camera's side of the interface.
          vFogY = uAir > 0.5 ? max( vFogY, 0.001 ) : min( vFogY, -0.001 );
        #endif
      }`,
    fragmentShader: `#include <fog_pars_fragment>
      ${GLSL_NOISE}
      uniform float uDbg;
      uniform float uTime, uBright, uFade, uStorm, uSunSize, uMirrorK, uNearK,
                    uFlash, uRefrK, uRefrSide, uEnvK, uFarR;
      uniform vec2 uCap, uOpaq2, uGlit, uWindD;
      uniform float uWindS;
      uniform vec4 uChop2, uSss, uSss2, uOpaq, uBoil, uDet, uRough, uRaftC;
      uniform vec4 uOcK, uOcSea;
      uniform vec3 uOcL;
      uniform sampler2D uOcSlope0, uOcSlope1, uOcSlope2, uOcFoam0, uOcFoam1, uOcFoam2;
      uniform vec3 uCam, uSunDir, uSkyZen, uSkyHor, uSunCol;
      ${GLSL_SKY_DECL}
      uniform sampler2D uRefr;
      uniform vec2 uRes;
      varying vec3 vW;
      varying vec2 vP0;
      varying vec2 vG;
      varying float vH;
      flat varying vec3 vHole;
      #ifdef SEA_ENV
        uniform sampler2D uSeaEnv;
        #include <cube_uv_reflection_fragment>
      #endif

      // THE RAFT'S SHADOW. The sun's depth map through a COMPARE sampler (three compiles
      // every non-raw ShaderMaterial as GLSL ES 3.00, so sampler2DShadow / texture()
      // are available here without a glslVersion switch). 1 = lit, 0 = in shadow.
      uniform highp sampler2DShadow uSunShadow;
      uniform mat4 uSunShadowMat;
      uniform float uShadowK;
      float sunShadow( vec3 P ){
        if ( uShadowK <= 0.0 ) return 1.0;
        vec4 sc = uSunShadowMat * vec4( P, 1.0 );
        sc.xyz /= sc.w;
        sc.z -= 0.0004;
        float e = min( min( sc.x, 1.0 - sc.x ), min( sc.y, 1.0 - sc.y ) );
        if ( e < 0.0 || sc.z > 1.0 || sc.z < 0.0 ) return 1.0;
        const float tx = 1.5 / 1024.0;
        float s = texture( uSunShadow, sc.xyz )
                + texture( uSunShadow, vec3( sc.x + tx, sc.y, sc.z ) )
                + texture( uSunShadow, vec3( sc.x - tx, sc.y, sc.z ) )
                + texture( uSunShadow, vec3( sc.x, sc.y + tx, sc.z ) )
                + texture( uSunShadow, vec3( sc.x, sc.y - tx, sc.z ) );
        return mix( 1.0, s * 0.2, uShadowK * smoothstep( 0.0, 0.06, e ) );
      }

      // The scene through the interface, sampled from the far-side render (see
      // renderRefraction). Offset hard-clamped at 0.035 NDC: an unbounded wobble in a gale
      // smeared the transmitted scene into ghosts (a phantom davit leg, measured).
      vec3 refrSample( vec3 R, vec3 V, vec2 dh, out float ok ){
        vec3 Rv = normalize( ( viewMatrix * vec4( R, 0.0 ) ).xyz );
        vec3 Vv = normalize( ( viewMatrix * vec4( V, 0.0 ) ).xyz );
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

      ${GLSL_SKY}
      ${GLSL_SEA_SKY}
      ${GLSL_FARSEA}

      // What is above a total-internal-reflection ray: the water column below, darkening
      // with depth, with the caustic sheet a few metres down sampled where R crosses it.
      vec3 mirrorRadiance( vec3 P, vec3 R, float t, float mk ){
        float Ry = min( R.y, -0.012 );
        float ea = clamp( fogDensity * ${f(K_EXT[1])} * 300.0, 1e-4, 30.0 );
        float wgt = ea < 0.6 ? 0.5 - ea * 0.0833333 + ea * ea * ea * 0.0013889
                             : 1.0 / ea - 1.0 / ( exp( ea ) - 1.0 );
        vec3 tr = exp( -fogDensity * ${v3(K_EXT)} * 300.0 );
        vec3 c = abyssaAmbient( fogColor, P.y + Ry * 300.0 * wgt ) * ( 1.0 - tr );
        float sh = fbm2( ( P.xz + R.xz * min( 16.0 / -Ry, 200.0 ) ) * 0.30
                         + vec2( t * 0.09, -t * 0.07 ) );
        return c * ( 1.0 - mk * ( 0.45 - 1.65 * sh * sh ) );
      }

      float rainRing( vec2 p, float t, float sd, out vec2 grad ){
        vec2 c = floor( p ), fp = fract( p ) - 0.5;
        float ph = fract( t * 0.85 + h21( c + sd ) );
        float d = max( length( fp ), 1e-3 );
        float w = d - ph * 0.44;
        float e = exp( -w * w * 300.0 ) * ( 1.0 - ph ) * ( 1.0 - ph );
        grad = ( fp / d ) * ( e * -600.0 * w );
        return e;
      }
      // The air side's stochastic splash field (jittered, dead cells, per-cell beat), on
      // two non-commensurate rotated lattices so no grid ever reads.
      float splash( vec2 p, float t, float sd, out vec2 grad ){
        vec2 c = floor( p );
        float h = h21( c + sd );
        float j1 = fract( h * 97.13 ), j2 = fract( h * 41.71 ), j3 = fract( h * 173.71 );
        float amp = step( ${f(GLASS.rain.splashDead)}, j3 ) * ( 0.55 + 0.75 * j3 );
        vec2 fp = fract( p ) - ( 0.5 + vec2( j1, j2 ) * 0.44 - 0.22 );
        float ph = fract( t * ( 0.62 + 0.55 * j2 ) + h );
        float d = max( length( fp ), 1e-3 );
        float w = d - ph * ( 0.11 + 0.09 * j1 );
        float e = exp( -w * w * 300.0 ) * ( 1.0 - ph ) * ( 1.0 - ph ) * amp;
        grad = ( fp / d ) * ( e * -600.0 * w );
        return e;
      }

      // Down-looking is not up-looking: what escapes the column upward is a few percent
      // of the isotropic field a diver is inside, and grey North-Atlantic water is the
      // palette desaturated, not re-tinted.
      vec3 seaBody( vec3 c ){
        return mix( c, vec3( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) ), 0.35 ) * 0.46;
      }

      // Foam micro-structure: bubbles and lace. A cellular-ish pattern from two value
      // noise octaves cut by the coverage itself, so thin foam is lace with holes and
      // thick foam closes into a sheet.
      float foamTex( vec2 p, float cov ){
        float n = vn( p * 1.7 ) * 0.55 + vn( p * 4.3 + 7.1 ) * 0.30 + vn( p * 11.0 - 3.3 ) * 0.15;
        return smoothstep( 0.62 - 0.55 * cov, 0.80 - 0.45 * cov, n + 0.35 * cov );
      }

      float seaS0(){ return uOcSea.w; }
      void main(){
        // Clipmap overlap band: the finer level owns everything inside its extent.
        if ( vHole.z > 0.0 ) {
          vec2 hd = abs( vG - vHole.xy );
          if ( max( hd.x, hd.y ) < vHole.z * 0.99999 ) discard;
        }
        vec3 V = normalize( vW - uCam );
        float dist = distance( vW.xz, uCam.xz );

        // ---- THE SPECTRUM AT THIS PIXEL ------------------------------------------
        // Three cascades, trilinear + anisotropic. The slope texture carries (s, s^2):
        // after the hardware averages a pixel's footprint, E[s^2] - E[s]^2 is exactly the
        // slope variance this pixel cannot show as a normal -- it becomes the roughness.
        vec2 q0 = vP0 / uOcL.x, q1 = vP0 / uOcL.y, q2 = vP0 / uOcL.z;
        vec4 s0 = texture2D( uOcSlope0, q0 ), s1 = texture2D( uOcSlope1, q1 ), s2 = texture2D( uOcSlope2, q2 );
        // CAT'S PAWS. Wind over water is gusty: the short wind-sea (cascade 2, half of
        // cascade 1) is patchy at the hundred-metre scale, darker ruffled patches drifting
        // downwind over smoother water. Without it the chop is one uniform texture to the
        // horizon -- the single strongest "tiled noise" tell. Slope AND its variance are
        // scaled, so a calm patch is also a glassier patch.
        vec2 gq = vP0 * 0.011 - uWindD * uTime * ( 0.04 + 0.10 * uWindS );
        float gust = 0.40 + 1.15 * smoothstep( 0.20, 0.80, vn( gq ) * 0.7 + vn( gq * 2.7 + 5.1 ) * 0.3 );
        gust = mix( gust, 1.0, 0.35 * seaS0() );
        float g1 = mix( 1.0, gust, 0.5 );
        vec2 dh = s0.xy + s1.xy * g1 + s2.xy * gust;
        float varU = max( s0.z - s0.x * s0.x, 0.0 ) + max( s0.w - s0.y * s0.y, 0.0 )
                   + ( max( s1.z - s1.x * s1.x, 0.0 ) + max( s1.w - s1.y * s1.y, 0.0 ) ) * g1 * g1
                   + ( max( s2.z - s2.x * s2.x, 0.0 ) + max( s2.w - s2.y * s2.y, 0.0 ) ) * gust * gust;
        vec4 j0 = texture2D( uOcFoam0, q0 ), j1 = texture2D( uOcFoam1, q1 ), j2 = texture2D( uOcFoam2, q2 );
        float Jxx = 1.0 + j0.x + j1.x + j2.x, Jzz = 1.0 + j0.y + j1.y + j2.y, Jxz = j0.z + j1.z + j2.z;
        float Jt = Jxx * Jzz - Jxz * Jxz;
        // FOAM: born where the whole sea (all cascades together) folds NOW, kept where a
        // parcel folded within the last few seconds (each cascade's persistent channel).
        float foamLive = 1.0 - smoothstep( uOcK.x - uOcK.y, uOcK.x, Jt );
        // Cascade 2's memory tiles every 17 u, so it is broken up by the gust field and
        // kept to a minor share: the short sea's foam is lace on the big crests' sheets.
        float foamMem = max( max( j0.w, j1.w ), j2.w * 0.45 * gust );
        float foamJ = max( foamLive, foamMem );

        vec3 N = normalize( vec3( -dh.x, 1.0, -dh.y ) );
        // Which side of the interface: the GEOMETRIC face, not the shading normal. Every
        // triangle is wound counter-clockwise seen from above, so the front face is the
        // air side. Asking dot(V, N) instead flipped grazing back-facets of the detail
        // normals into the underwater branch, which drew dark slivers across the far sea.
        bool below = !gl_FrontFacing;
        // FROM BELOW the short chop is filtered (the shipped detailBelow idea, applied to
        // the spectrum's bands): it shatters Snell's window into confetti at the depths
        // Sal looks up from, and the diver's wayfinding needs the window whole.
        if ( below ) dh = s0.xy + s1.xy * g1 * 0.65 + s2.xy * gust * uDet.w;
        // Unresolved roughness: the filtered variance, plus the capillaries finer than
        // cascade 2's Nyquist (uOcK.w grows with the wind).
        float mssU = varU + uOcK.w;
        float alpha = clamp( sqrt( mssU ), 0.02, 0.6 );
        alpha = mix( 0.02, alpha, uRough.y );

        float seaS = uOcSea.w;
        float hRef = max( 0.5 * uOcSea.x, 0.12 );
        float waveY = vH;

        // ---- CHURNED-WATER OPACITY: bubbles close the window as the sea churns.
        float churn = smoothstep( uOpaq.y, uOpaq.z, max( uStorm, uWindS ) );
        float opq = clamp( uOpaq.x * max( churn, uOpaq.w * foamJ ), 0.0, 1.0 );

        float rain = 0.0, splashV = 0.0;
        vec2 dhSpl = vec2( 0.0 );
        if ( uStorm > 0.02 ) {
          float rk = uStorm * uNearK * ( 1.0 - smoothstep( 6.0, 26.0, dist ) );
          vec2 g1, g2;
          if ( below ) {
            float r1 = rainRing( vW.xz * 2.2, uTime, 0.0, g1 );
            float r2 = rainRing( vW.xz * 4.5, uTime * 1.27, 11.0, g2 );
            dh += ( g1 * 0.0022 + g2 * 0.0011 ) * rk;
            rain = ( r1 + 0.6 * r2 ) * rk;
          } else {
            vec2 pf = vW.xz * ${f(GLASS.rain.splashScales[1])};
            pf = vec2( pf.x * ${f(Math.cos(GLASS.rain.splashRot))} - pf.y * ${f(Math.sin(GLASS.rain.splashRot))},
                       pf.x * ${f(Math.sin(GLASS.rain.splashRot))} + pf.y * ${f(Math.cos(GLASS.rain.splashRot))} );
            float sa = splash( vW.xz * ${f(GLASS.rain.splashScales[0])}, uTime, 0.0, g1 );
            float sb = splash( pf, uTime * 1.31, 11.0, g2 );
            dhSpl = ( g1 * 0.0030 + g2 * 0.0016 ) * rk;
            splashV = ( sa + 0.7 * sb ) * rk;
          }
        }

        // SURFACE BOIL, geometry half: ripple rings radiating from Sal's breach point.
        if ( uBoil.z > 0.004 ) {
          vec2 bd0 = vW.xz - uBoil.xy;
          float bl0 = max( length( bd0 ), 1e-3 );
          if ( bl0 < uBoil.w + 1.0 ) {
            float bA = clamp( uBoil.z, 0.0, 1.0 );
            float ph1 = fract( uTime * 1.35 );
            float w1 = bl0 - ph1 * ( uBoil.w + 0.7 );
            float e1 = exp( -w1 * w1 * 240.0 ) * ( 1.0 - ph1 );
            float ph2 = fract( uTime * 1.35 + 0.47 );
            float w2 = bl0 - ph2 * ( uBoil.w + 0.7 );
            float e2 = exp( -w2 * w2 * 240.0 ) * ( 1.0 - ph2 );
            dh += ( bd0 / bl0 ) * ( ( e1 * w1 + e2 * w2 ) * -520.0 ) * 0.0034 * bA;
          }
        }

        // THE HULL. Water piles and tears against the raft: a ragged white collar on
        // the waterline, thicker where the hull is working (uRaftC.w = |heave rate|).
        float hull = 0.0;
        {
          vec2 rq = abs( vW.xz - uRaftC.xy ) - vec2( uRaftC.z );
          float rd = length( max( rq, 0.0 ) ) + min( max( rq.x, rq.y ), 0.0 );
          if ( rd < 2.2 && rd > -0.4 ) {
            float band = ( 1.0 - smoothstep( 0.0, 0.55 + 1.1 * uRaftC.w + 0.5 * seaS, rd ) )
                       * smoothstep( -0.40, -0.05, rd );
            float tn = vn( vW.xz * 2.6 + vec2( uTime * 0.7, -uTime * 0.45 ) ) * 0.6
                     + vn( vW.xz * 7.0 - vec2( uTime * 1.3, uTime * 0.9 ) ) * 0.4;
            hull = band * smoothstep( 0.30, 0.75, tn * ( 0.55 + 0.9 * band ) ) * ( 0.55 + 0.45 * min( 1.0, uRaftC.w * 2.0 + seaS ) );
            // Seen from below the collar is a thin bubble line against the bright window,
            // and a full-strength one drew the hull's rectangle in white chalk.
            if ( !gl_FrontFacing ) hull *= 0.3 * smoothstep( 0.35, 0.65, vn( vW.xz * 1.1 + uTime * 0.2 ) );
          }
        }

        N = normalize( vec3( -dh.x, 1.0, -dh.y ) );
        vec3 Nf = below ? N : -N;
        float ct = dot( V, Nf ), F;
        float mk = uMirrorK * ( 1.0 - smoothstep( 35.0, 120.0, dist ) );
        // Foam is lit like a rough white solid: the surface irradiance proxy (fogColor,
        // which dims with night and storm on its own) plus the direct sun on its face.
        vec3 foamCol = vec3( 0.86, 0.94, 1.00 ) * dot( fogColor, vec3( 0.36, 0.50, 0.34 ) ) * 4.6;
        float airK = 0.0, farK = 0.0;
        vec3 col = vec3( 0.0 );
        float sh = sunShadow( vW ) * cloudSun( vW.xz );
        bool dOff = uDbg > 0.5;
        bool dFoam = !dOff || abs( uDbg - 4.0 ) < 0.5;
        bool dHaze = !dOff || abs( uDbg - 6.0 ) < 0.5;
        vec3 tRefl = vec3( 0.0 ), tBody = vec3( 0.0 ), tTrans = vec3( 0.0 ), tSss = vec3( 0.0 ), tGlit = vec3( 0.0 );
        if ( below ) {
          // ---- FROM BELOW: Snell's window, TIR mirror, the far-side render ----------
          float kk = 1.0 - ETA * ETA * ( 1.0 - ct * ct );
          float ca = sqrt( max( kk, 0.0 ) );
          F = kk <= 0.0 ? 1.0 : F0 + ( 1.0 - F0 ) * pow( 1.0 - ca, 5.0 );
          float mf = smoothstep( 0.030, 0.090, F );
          if ( F < 0.998 ) {
            vec3 T = refract( V, -Nf, ETA );
            vec3 win = skyRadiance( T );
            float rk = uRefrK * ( 1.0 - uRefrSide ) * ( 1.0 - opq * uOpaq2.x );
            if ( rk > 0.001 ) {
              float ok; vec3 rs = refrSample( T, V, dh, ok );
              win = mix( win, rs, rk * ok );
            }
            col = win * ( 1.0 - F ) * ( 1.0 - 0.55 * ( 1.0 - sh ) );
          }
          if ( mf > 0.0 )  col += mirrorRadiance( vW, reflect( V, Nf ), uTime, mk ) * ( F * mf )
                               * ( 1.0 - 0.35 * ( 1.0 - sh ) );
        } else {
          // ---- THE SEA FROM ABOVE ------------------------------------------------
          vec2 dhA = dh + dhSpl;
          vec3 Na = normalize( vec3( -dhA.x, 1.0, -dhA.y ) );
          // A shading normal facing away from the eye is a facet hidden behind its own
          // wave: bend it back to grazing so it reflects the sky at the horizon instead
          // of reflecting the sea (the classic normal-map horizon fix).
          float vn0 = dot( V, Na );
          if ( vn0 > -0.02 ) Na = normalize( Na - V * ( vn0 + 0.02 ) );
          float cta = clamp( -dot( V, Na ), 0.0, 1.0 );
          F = seaFresnel( V, Na, alpha );
          vec3 T = refract( V, Na, 1.0 / ETA );
          vec3 body = seaBody( mirrorRadiance( vW, T, uTime, mk * 0.55 ) );
          vec3 bodyA = body;
          float rk = uRefrK * uRefrSide * ( 1.0 - opq );
          if ( rk > 0.001 ) {
            float ok; vec3 rs = refrSample( T, V, dhA, ok );
            body = mix( body, mix( rs, body, 0.15 ), rk * ok );
            tTrans = rs * ( 0.85 * rk * ok );
          }
          float bodyW = ( 1.0 - F ) * ( 1.0 - 0.45 * ( 1.0 - sh ) );
          tBody = bodyA * bodyW; tTrans *= bodyW;
          // REFLECTION. The sky the real sea mirrors: the dome's own radiance along the
          // facet-lifted reflected ray, sharp where the water is glassy, and the
          // prefiltered sky environment at the spectrum's roughness where it is not
          // (the matte-mirror lean raises the reflection's roughness floor).
          float aR = max( alpha, ( 0.03 + 0.16 * abyssaStyle.z ) * ( 1.0 - opq ) );
          vec3 R = seaReflDir( V, Na, aR );
          // The painted disc is drawn by the glitter lobe below, not by the mirror.
          gSunK = uRough.z; gHaloK = sh;
          float envW = 0.0;
          #ifdef SEA_ENV
            envW = uEnvK * smoothstep( 0.05, 0.22, aR );
          #endif
          vec3 sky = vec3( 0.0 );
          if ( uSkyEnvK > 0.5 ) { sky = seaSkyEnvRough( R, 0.9 * aR ); envW = 0.0; }
          else if ( envW < 0.999 ) sky = skyRadiance( R );
          #ifdef SEA_ENV
            if ( envW > 0.001 ) {
              vec3 env = textureCubeUV( uSeaEnv, vec3( -R.x, R.y, R.z ), clamp( aR * 1.4, 0.0, 1.0 ) ).rgb;
              sky = mix( sky, env, envW );
            }
          #endif
          tRefl = sky * F;
          col = body * bodyW + tRefl;
          gSunK = 1.0; gHaloK = 1.0;
          if ( uRough.z < 0.999 ) {
            tGlit = seaGlitter( Na, V, alpha, sh ) * ( 1.0 - uRough.z );
            col += tGlit;
          }

          // ---- SUBSURFACE: the green glow of light through the wave's mass ----------
          // Sunlight entering the back of a swell and leaving through its face, strongest
          // where the fragment is high on its own wave (more lit mass behind it), toward
          // the sun, and where the surface transmits (sqrt of 1 - F).
          if ( uSss.x > 0.001 ) {
            float dayS = smoothstep( uSss2.z, uSss2.w, uSunDir.y ) + 0.6 * ( 1.0 - smoothstep( 0.02, 0.30, uSunDir.y ) ) * step( 0.02, uSunDir.y );
            if ( dayS > 0.002 ) {
              float h01 = clamp( waveY / hRef * 0.5 + 0.5, 0.0, 1.0 );
              vec2 sxz2 = uSunDir.xz;
              float sl2 = length( sxz2 );
              float tw = sl2 > 1e-3 ? dot( normalize( V.xz ), sxz2 / sl2 ) : 0.0;
              float viewS = ( 0.30 + 0.70 * ( 0.5 + 0.5 * tw ) ) * ( 0.35 + 0.65 * ( 1.0 - abs( V.y ) ) );
              // Thin crests let the most through: the face of a steep wave toward the sun.
              float face = clamp( dot( -Na.xz, sxz2 / max( sl2, 1e-3 ) ) * 2.5, 0.0, 1.0 );
              float seaG = uSss2.y + ( 1.0 - uSss2.y ) * smoothstep( 0.0, 0.85, seaS );
              // Under a storm lid the light is diffuse: no beam through the swell's back.
              float beam = 1.0 - 0.75 * smoothstep( 0.3, 0.9, uStorm );
              float amt = pow( smoothstep( 0.35, 1.0, h01 ), uSss.y ) * ( 0.35 + 0.65 * face ) * min( dayS, 1.0 ) * viewS * seaG * beam
                        * ( 1.0 + uOpaq2.y * opq )
                        * ( 1.0 - smoothstep( 220.0, 430.0, dist ) ) * uNearK * uSss.x * sh;
              vec3 sssRaw = fogColor * exp( -${v3(K_EXT)} * uSss.z ) * uSss.w;
              float sMax = max( sssRaw.r, max( sssRaw.g, sssRaw.b ) );
              vec3 sssCol = sssRaw * ( sMax > uSss2.x ? uSss2.x / sMax : 1.0 );
              tSss = sssCol * clamp( amt, 0.0, 1.0 ) * sqrt( max( 1.0 - F, 0.0 ) );
              col += tSss;
            }
          }
          if ( dOff ) {
            if ( uDbg < 1.5 ) col = tRefl;
            else if ( uDbg < 2.5 ) col = tBody;
            else if ( uDbg < 3.5 ) col = tTrans;
            else if ( uDbg < 5.5 && uDbg > 4.5 ) col = tSss;
            else if ( uDbg > 7.5 && uDbg < 8.5 ) col = tGlit;
            else if ( uDbg > 8.5 ) col = vec3( alpha, sqrt( varU ), foamJ );
            else col = vec3( 0.0 );
          }
          // THE FAR BAND. The mesh ends at the camera's far plane; past it the dome draws
          // farSea(). Over the last stretch the near shading eases into that same BRDF so
          // the hand-off is a function meeting itself.
          farK = smoothstep( uFarR * 0.70, uFarR * 0.97, dist );
          airK = smoothstep( 6.0, 220.0, dist );
        }

        // ---- WHITECAPS -------------------------------------------------------------
        // The Jacobian of the FFT displacement: below 1 the water is crowding, below the
        // threshold it is breaking. Live folds are solid; the persistent memory decays
        // into lace and streaks behind the crest (it lives in parameter space, so it is
        // left where the parcel broke while the wave moves on). Lit like a solid: sky
        // irradiance plus the sun on its face, shadowed by the raft.
        float fj = clamp( foamJ, 0.0, 1.0 ) * ( 1.0 - smoothstep( 160.0, 420.0, dist ) ) * uNearK;
        fj = max( fj, hull );
        if ( fj > 0.003 && dFoam ) {
          vec2 wr = vec2( vW.x * uWindD.x + vW.z * uWindD.y, -vW.x * uWindD.y + vW.z * uWindD.x );
          float st = 1.0 + uChop2.y * uWindS;
          vec2 fp = vec2( wr.x / st, wr.y ) * uChop2.x;
          float fm = foamTex( fp + vec2( -uTime * 0.05, 0.0 ), fj );
          float NoLf = max( dot( N, uSunDir ), 0.0 );
          float lum = dot( uSunCol, vec3( 0.2126, 0.7152, 0.0722 ) );
          vec3 capCol = vec3( 0.90, 0.97, 0.95 ) * dot( fogColor, vec3( 0.36, 0.50, 0.34 ) ) * 4.6
                      * ( 0.62 + 0.38 * NoLf * sh * smoothstep( 0.5, 1.2, lum ) );
          capCol = min( capCol, vec3( 0.34 ) );
          float capW = smoothstep( uCap.x, min( 0.98, uCap.x + 0.30 ), uWindS );
          col = mix( col, capCol, clamp( fj * fm * ( 0.75 + 0.25 * capW ), 0.0, 0.94 ) );
          // A thin bubble veil under fresh foam: milky turquoise, not white.
          if ( !below ) col += foamCol * 0.05 * fj * ( 1.0 - fm );
        }

        // SURFACE BOIL, colour half: churning white where Sal's exhaust breaks through.
        if ( uBoil.z > 0.004 ) {
          vec2 bdc = vW.xz - uBoil.xy;
          float blc = length( bdc );
          if ( blc < uBoil.w ) {
            float bA = clamp( uBoil.z, 0.0, 1.0 );
            float bk = 1.0 - smoothstep( 0.0, uBoil.w, blc );
            float bn = vn( vW.xz * 6.5 + vec2( uTime * 1.9, -uTime * 2.4 ) ) * 0.6
                     + vn( vW.xz * 13.0 - vec2( uTime * 3.3, uTime * 2.1 ) ) * 0.4;
            float bw = bA * bk * smoothstep( 0.26, 0.72, bn * ( 0.55 + 0.95 * bk * bA ) );
            if ( dFoam ) col = mix( col, foamCol, clamp( bw, 0.0, 0.85 ) );
          }
        }

        // BACKLIT CREST SCATTER: low sun beyond a thin, steep crest -- the green the water
        // leaves, the one moment the sea is lit from inside. Air side only.
        if ( !below && uChop2.z > 0.001 ) {
          float lum = dot( uSunCol, vec3( 0.2126, 0.7152, 0.0722 ) );
          float sunUp = smoothstep( 0.50, 1.10, lum );
          float lowSun = ( 1.0 - smoothstep( 0.08, 0.45, uSunDir.y ) ) * sunUp;
          vec2 sxz = uSunDir.xz;
          float sl = length( sxz );
          float toward = sl > 1e-3 ? max( dot( normalize( V.xz ), sxz / sl ), 0.0 ) : 0.0;
          float gRef = 0.06 + 0.25 * seaS;
          float thin = smoothstep( 0.30, 1.00, waveY / hRef )
                     * smoothstep( 0.45, 1.25, length( dh ) / gRef );
          float sc = uChop2.z * lowSun * pow( toward, uChop2.w ) * thin
                   * ( 1.0 - smoothstep( 60.0, 240.0, dist ) ) * uNearK;
          if ( !dOff ) col += vec3( 0.18, 0.66, 0.46 ) * clamp( sc, 0.0, 1.0 ) * min( lum * 0.62, 0.20 );
        }
        if ( dFoam ) col += foamCol * ( below ? rain * 0.25 : splashV * ${f(GLASS.rain.splashK)} );
        if ( !dOff ) col += vec3( 0.72, 0.80, 0.92 ) * uFlash * 0.30 * uNearK;
        gBoltK = 0.15;
        if ( farK > 0.0 && dHaze ) col = mix( col, farSea( V, fogColor ), farK );
        if ( airK > 0.0 && dHaze ) col = airFog( col, 0.0, airK );

        gl_FragColor = vec4( col * uBright, uFade );
        #include <fog_fragment>
      }`
  });
  mat.transparent = true;
  mat.depthWrite = false;
  surface = new THREE.Mesh(buildOceanGeometry(), mat);
  surface.renderOrder = -1;          // behind everything; it is a ceiling, not an occluder
  surface.frustumCulled = false;
  surface.onBeforeRender = (r, s, cam) => {
    uCam.value.copy(cam.position);
    updateOceanGrid(cam.position.x, cam.position.z);
    uFarR.value = cam.far;
  };
  scene.add(surface);
  applySeaEnv();
}

// The sky environment the rough sea reflects. The dome's PMREM capture (sun disc
// excluded, so the glitter lobe is the only sun on the water) unless something better
// is registered: setSeaEnv(pmremTexture) -- e.g. a volumetric-cloud sky capture -- takes
// over, and setSeaEnv(null) hands back to the dome's.
let _seaEnvExt = null, _seaEnvDome = null;
export function setSeaEnv(tex) { _seaEnvExt = tex || null; applySeaEnv(); }
function applySeaEnv() {
  const t = _seaEnvExt || _seaEnvDome;
  if (!surface || !t || !t.image) return;
  const m = surface.material;
  const H = t.image.height, maxMip = Math.log2(H) - 2;
  const tw = 1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16)), th = 1 / H;
  const want = { SEA_ENV: 1, ENVMAP_TYPE_CUBE_UV: 1, CUBEUV_TEXEL_WIDTH: tw, CUBEUV_TEXEL_HEIGHT: th, CUBEUV_MAX_MIP: maxMip.toFixed(1) };
  let diff = false;
  for (const k in want) if (m.defines[k] !== want[k]) { m.defines[k] = want[k]; diff = true; }
  uSeaEnv.value = t;
  if (diff) m.needsUpdate = true;
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
  buildShadowFallback();   // before buildSurface: its uniform must never hold null
  buildOcean();            // the wave field's targets exist before the surface samples them
  buildDome();
  buildSurface();
  buildRays();
  snow = new THREE.Group();
  // near grit gives the parallax that sells "I am inside a medium"
  // Size 0.020 -> 0.026: at the 1940-px canvas the near grit resolved as 1-px pin-pricks
  // and read as noise rather than as matter drifting in front of the lens.
  snow.add(snowLayer(2400, 30, 0.026, 0.36, 0.55, [0.55, 0.75, 0.85], [0.80, 0.86, 0.78]));
  // far snow: bigger, slower, with a few large detritus flakes from the size^2 bias.
  // Box 170 -> 300 (fade band 150..96 instead of 85..54) and 3200 -> 4200 points to
  // hold the same density in the larger volume. At 250 units in the zone-0 clear band
  // it still reads 30% transmittance — real mid-field grit, where today there is
  // nothing at all between 85 and 205 units.
  snow.add(snowLayer(4200, 300, 0.075, 0.30, 0.35, [0.50, 0.70, 0.85], [0.86, 0.80, 0.62], 0.45));
  scene.add(snow);
  buildParticulate(scene, { uTime, uCam, uExtG, uPix: uPixP, lampA: LAMPA_U, lampAC: LAMPAC_U });
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

// ---------------------------------------------------------------------------
// SKY DRAMA — clouds, the marine layer and the moon, resolved on the CPU once a frame
// and written into the uniforms skyRadiance()/airFog() read. Everything expensive is
// here rather than in the shader: colours, the moon's placement and the cloud
// advection are a few dozen ops a frame, against a dome-full of fragments.
//
// ZERO ALLOCATION: the two colour scratch arrays are module-scoped, and the uniforms
// are Vector2/3/4 objects written with .set(). No trig in here beyond one sin/cos pair
// for the wind and one for the moon.
const _cLit = [0, 0, 0], _cBase = [0, 0, 0], _ember = [0, 0, 0], _pRing = [0, 0, 0];

// Published for world/clouds.js: the SAME two colours the painted dome mixes between,
// plus the backlit amount and the storm envelope. The instanced puffs are lit by the
// palette exactly the way the dome is — that is the whole reason the two read as one
// sky rather than as two cloud systems. `lit`/`base` are the LIVE uniform vectors, so
// there is nothing to keep in sync and nothing copied per frame.
// THE VOLUMETRIC SKY'S HOOKS (world/sky.js). skyPalette() hands it this frame's authored
// palette (the LEVEL it normalises its physical sky to); setSkyRing() hands back the
// physical horizon and zenith, which then become the ring the sea mirrors and the
// airlight the fog chunk and the far sea converge on: one horizon number, now weather.
// Called after updateWater every frame; skyDrama rewrites the palette first next frame.
const _palOut = { zen: _pZen, hor: _pRing, disc: _pDisc };
export function skyPalette() { return _palOut; }
export function setSkyRing(hor, zen, cov) {
  uSkyHor.value.set(hor[0], hor[1], hor[2]);
  uSkyZen.value.set(zen[0], zen[1], zen[2]);
  AIR_U[0] = hor[0]; AIR_U[1] = hor[1]; AIR_U[2] = hor[2]; AIR_U[3] = 1;
  const ck = clamp(cov, 0, 1) * 0.8;
  for (let i = 0; i < 3; i++) AIRZ_U[i] = zen[i] + (0.5 * (_cBase[i] + _cLit[i]) - zen[i]) * ck;
  AIRZ_U[3] = 1;
  skyState.hor[0] = hor[0]; skyState.hor[1] = hor[1]; skyState.hor[2] = hor[2];
}
export const cloudLook = {
  lit: uCloudLit.value, base: uCloudBase.value, bak: 0, storm: 0, dome: 1, lid: 0
};
// The moon's own arc: elevation is the sun's elevation proxy NEGATED, so it is highest
// at midnight and gone by mid-morning, and its azimuth is the sun's plus 180. That is
// not celestial mechanics — it is the one arrangement that guarantees the moon is never
// in the sky beside the sun, which is the only way this can look wrong at a glance.
const _d2r = Math.PI / 180;
function skyDrama(dt, storm) {
  const G = GLASS, C = G.cloud, F = G.fog, M = G.moon;
  const h = wHand;

  // --- clouds -------------------------------------------------------------
  const clouds = h ? h.clouds : 0.22, cTex = h ? h.cloudTex : 0.35;
  uCloudScale.value = C.scale;
  uCloudCov.value = clamp(C.covCalm + C.covGain * clouds + C.covStorm * storm, 0, 0.98);
  uCloudSoft.value = ml(C.softCalm, C.softStorm, storm);
  uCloudTex.value = clamp(cTex + 0.45 * storm, 0, 1);

  // SHAPING. The island swing dies as coverage closes (a deck has no islands) AND as the
  // storm envelope rises; the zenith bias and the ragged edge die with the storm alone,
  // because a gale's lid is flat and covers the zenith. At full storm every term here is
  // zero and the field is exactly the deck that shipped — which is what keeps the storm
  // look a regression-checkable constant (measured mean amt 0.227 -> 0.247, spatial sd
  // 0.183 -> 0.186; the flat lid is intact).
  const shut = (1 - ms(uCloudCov.value, 0.62, 0.94)) * (1 - storm);
  uCloudIsl.value.set(C.islScale, C.islGate, C.islSoft, C.islAmp * shut);
  uCloudShp.value.set(C.ragScale, C.rag * (1 - storm), C.zenBias * (1 - storm), C.hazeUp);

  // Backlit amount: full at and below the ring stops' solar elevation, gone by the time
  // the sun is properly up. Storm-scaled because a deck already collapses lit toward
  // base (stormLit) and doubling the two just flattens it to one grey.
  uCloudBak.value = (1 - clamp(SUN.elevDeg / C.backElev, 0, 1)) * (1 - storm);

  // FORM. All four amounts die with the storm envelope, exactly like the shaping terms,
  // so the gale's deck stays the flat regression-checkable lid it has always been.
  // The BASE amount additionally dies with uCloudBak: at the ring stops the backlit pow
  // is already crushing the whole body toward uCloudBase, and stacking a second skirt
  // darkening on top of it is how you get a black hole low in a dusk sky. The flank,
  // crown and detail terms stay ALIVE at dusk on purpose — they are what decides which
  // side of a clump catches the ember colour the CPU has already walked uCloudLit
  // toward, so the sunset payoff needs no second ember path of its own.
  const frm = 1 - storm;
  uCloudFrm.value.set(C.formGrad, C.formDepth, C.formShade * frm,
                      C.formBase * frm * (1 - uCloudBak.value));
  uCloudFrm2.value.set(C.formTop * frm, C.formDetail * frm);

  // Drift. The wind's bearing is integrated into a uv OFFSET on the CPU, so the shader
  // does no trig and a direction change simply starts moving the deck a new way — no
  // jump, because the offset is continuous through it. dt is the frame's, so a 4x lab
  // speed drifts 4x as far without a second clock.
  if (wWind) {
    const k = C.drift * wWind.speed * dt;
    uCloudDrift.value.x += Math.cos(wWind.dir) * k;
    uCloudDrift.value.y += Math.sin(wWind.dir) * k;
  } else {
    uCloudDrift.value.x += C.drift * 0.25 * dt;   // the shipped deck's slow crawl
  }

  // The sunward step for the lit-edge gradient, in the same uv space the field is
  // sampled in. Length is one cloud's worth at the authored scale.
  const sx = SUN.dir.x, sz = SUN.dir.z, sl = Math.hypot(sx, sz) || 1;
  uSunUV.value.set(sx / sl * 0.55, sz / sl * 0.55);

  // Colours. Both ends are made from the palette's HORIZON radiance, so a cloud is
  // always lit by the day it is in and needs no stop of its own.
  // The two storm-lid numbers travel with the SAME solar-height gate the two storm stops
  // do (_dayG, resolved in palette() earlier this frame). A night gale keeps the shipped
  // 0.30 / 0.26 exactly; a noon gale keeps a lit top and a dark underside instead of
  // collapsing into one grey ceiling, which is what the reference's lid actually does.
  // Note the lit/base ENDS are both made from _pHor, which the stormDay stop has already
  // brightened — so this pair only sets the SEPARATION, never the overall level.
  const stormLit = ml(C.stormLit, C.stormLitDay, _dayG);
  const baseDark = ml(C.baseDark, C.baseDarkDay, _dayG);
  const litK = ml(C.litK, stormLit, storm);
  // Floored at 0. A cloud underside is allowed to be black; it is not allowed to be a
  // negative radiance, and the pair above can reach one if anyone authors baseDark over
  // baseK (measured: -0.025 at baseDarkDay 0.48). One max() makes that unauthorable.
  const baseK = Math.max(0, C.baseK - baseDark * uCloudTex.value) * (1 - 0.30 * storm);
  for (let i = 0; i < 3; i++) { _cLit[i] = _pHor[i] * litK; _cBase[i] = _pHor[i] * baseK; }

  // EMBER UNDERSIDES — the post-storm-clearing payoff. Only at low sun, only by the
  // day's own sunsetDrama, and killed by an active storm (a gale has no sunset). The
  // disc colour is renormalised to GLASS.cloud.emberK so the payoff is HUE and COVERAGE,
  // never a blown-out sky: broken cloud left over from a squall catches the light, a
  // clear day has nothing up there to catch it, and that difference IS the drama.
  // The gate on wDay is a SMOOTHSTEP, not the raw factor: at the dusk stop the daylight
  // scalar is already halfway down, and multiplying by it directly killed the ember
  // exactly where it is supposed to live (measured: 0.155 lit on a drama-0.55 evening
  // against 0.153 on a drama-0.08 one — no difference at all). The step keeps it full
  // through dusk and still takes it to zero by deep night, where the "disc" is the moon.
  const drama = h ? h.sunsetDrama : 0;
  const ember = clamp(drama * C.emberGain, 0, 1)
              * (1 - clamp(SUN.elevDeg / C.emberElev, 0, 1))
              * (1 - storm) * ms(wDay, 0.05, 0.42);
  if (ember > 0.002) {
    const mx = Math.max(_pDisc[0], _pDisc[1], _pDisc[2]) || 1, s = C.emberK / mx;
    for (let i = 0; i < 3; i++) {
      _ember[i] = _pDisc[i] * s;
      _cLit[i] += (_ember[i] - _cLit[i]) * ember;
      _cBase[i] += (_ember[i] * 0.80 - _cBase[i]) * ember;
    }
  }
  uCloudLit.value.set(_cLit[0], _cLit[1], _cLit[2]);
  uCloudBase.value.set(_cBase[0], _cBase[1], _cBase[2]);

  // THE HANDOFF, resolved here so both systems read one number. GLASS.cloud.dome is the
  // fair-weather amount of PAINTED cloud left on the dome (the distant backdrop the
  // instanced puffs fade into); the storm envelope drives it back to a full lid, which
  // is what world/clouds.js fades its clusters out against.
  uCloudDome.value = clamp(C.dome + (1 - C.dome) * ms(storm, 0.25, 0.85), 0, 1);

  // ---- THE SKY UNDER THE LID -------------------------------------------------
  // THE MILKY SEA (Michael, bright overcast, deck at 0 m: "looks like a snowfield").
  // Measured with the uDbg decomposition: from deck height the sea can only mirror the
  // lowest ~10 degrees of sky, and that band was ALWAYS the clear-day horizon ring —
  // every stop is authored hor 2.4-6x its zenith, the deck dissolves back into that
  // ring over the lowest hazeUp (config: THE MILKY BAND), and the fog chunk's airlight
  // was the noon ring baked in. So under a closed lid the zenith read 0.20 while the
  // sea 4 degrees under the horizon read 0.41 and the far band 0.77 against a horizon
  // sky of 0.66: the sea mirrored a bright ring the lid overhead had already hidden,
  // then had the same ring stacked on top as haze. A real overcast is darkest low
  // (CIE overcast: horizon = zenith / 3) with at most a hazy slit at the horizon, and
  // the sea under it is dark steel because it mirrors the underside of the deck.
  //
  // So the ring the dome draws, the ring the sea mirrors and the airlight the far
  // field settles on become ONE number that follows the lid: the authored horizon,
  // pulled toward the deck's own underside (mix of this frame's base and lit cloud
  // colours — the stop's hue, only darker) by how closed the lid is. lidRing keeps a
  // share of the authored ring alive under a full deck: Michael's gale reference is a
  // black lid over a HAZY BRIGHT horizon, and at 0.15 the gale horizon is ~6x its
  // underside while sitting ~3x under today's. Fair-weather cumulus (cov under lidCov)
  // and the calm-noon anchor are bit-identical: lidK is exactly 0 there.
  const cov = uCloudCov.value;
  const lidK = Math.max(ms(cov, C.lidCov[0], C.lidCov[1]), ms(storm, C.lidStorm[0], C.lidStorm[1]));
  if (lidK > 0) {
    for (let i = 0; i < 3; i++) {
      // Flow lean: a hazier slit under the lid (the ring's share up to 1.5x at full lean).
      const under = _cBase[i] + (_cLit[i] - _cBase[i]) * C.lidHz + _pHor[i] * C.lidRing * (1 + 0.5 * STYLE_U[3]);
      _pRing[i] = _pHor[i] + (Math.min(under, _pHor[i]) - _pHor[i]) * lidK;
    }
  } else { _pRing[0] = _pHor[0]; _pRing[1] = _pHor[1]; _pRing[2] = _pHor[2]; }
  uSkyHor.value.set(_pRing[0], _pRing[1], _pRing[2]);
  AIR_U[0] = _pRing[0]; AIR_U[1] = _pRing[1]; AIR_U[2] = _pRing[2]; AIR_U[3] = 1;
  {
    const ck = clamp(uCloudCov.value * uCloudDome.value, 0, 1) * 0.8;
    for (let i = 0; i < 3; i++) {
      const deck = 0.5 * (_cBase[i] + _cLit[i]);
      AIRZ_U[i] = _pZen[i] + (deck - _pZen[i]) * ck;
    }
    AIRZ_U[3] = 1;
  }
  cloudLook.lid = lidK;
  cloudLook.bak = uCloudBak.value;
  cloudLook.storm = storm;
  cloudLook.dome = uCloudDome.value;

  // --- marine layer -------------------------------------------------------
  // Amount from the hand, burn-off from the SUN'S ELEVATION against the hand's own
  // fogBurn: the sun eats it from the top down and a scrub through the morning shows it
  // go. Storms blow it out; deep night keeps a share of it (a night fog is real, and the
  // colour it whites to is the night horizon, so it goes dark on its own).
  let fk = 0;
  if (h && h.fog > F.thr) {
    fk = ms(h.fog, F.thr, F.full)
       * (1 - ms(SUN.elevDeg, h.fogBurn - F.burnBand, h.fogBurn))
       * (1 - F.stormKill * storm)
       * ml(F.nightK, 1, wDay);
  }
  uFog.value = fk * F.maxK;
  // PERF: on a pea-soup morning the dome still paid for the whole fbm cloud block and
  // then painted airFog over the result. Crushing the coverage uniform on the CPU lets
  // the shader's existing uCloudCov > 0.005 gate skip the block entirely once the fog
  // is heavy enough that no cloud contrast survives the airFog mix anyway (at fk 0.97
  // the mix leaves under 9% of it, times distK). The ramp starts at 0.60 so light and
  // moderate fog — where cloud silhouettes still ghost through — are untouched, and a
  // CLEAR day (fk = 0) is bit-identical. Runs after the clouds section on purpose:
  // shut/isl were derived from the unscaled coverage, and on the only frames where
  // this crush bites the whole block is skipped, so they are never read.
  uCloudCov.value *= 1 - ms(fk, 0.60, 0.97);
  uFogCol.value.set(_pHor[0] * F.col[0], _pHor[1] * F.col[1], _pHor[2] * F.col[2]);
  // Heavy fog dims the disc — which is the same uniform the GLITTER PATH is made of, so
  // killing the disc kills the glitter in one write. That is the whole reason the discs
  // live inside skyRadiance().
  uDiscK.value = 1 - F.discK * fk;

  // --- the moon -----------------------------------------------------------
  // Visible only as the day gives out; uMoonCol at zero is what makes daylight cost one
  // compare in the shader.
  const nightK = clamp((0.40 - wDay) / 0.34, 0, 1);
  const moonK = h ? h.moonK : 0;
  const proxy = Math.cos(Math.PI * 2 * SKY.phase01);        // +1 at midnight
  const mElev = M.elevMax * proxy;
  const vis = nightK * moonK * clamp(mElev / 6, 0, 1) * (1 - 0.85 * storm) * (1 - 0.9 * uFog.value);
  if (vis > 0.004) {
    const el = mElev * _d2r, az = (SUN.azimDeg + M.azimOffset) * _d2r;
    const ce = Math.cos(el);
    uMoonDir.value.set(ce * Math.cos(az), Math.sin(el), ce * Math.sin(az));
    // The terminator axis is the moon's horizontal perpendicular: cross(dir, up),
    // normalised. At this art scale a horizontal terminator is what reads as a phase.
    _tmp.set(uMoonDir.value.z, 0, -uMoonDir.value.x);
    if (_tmp.lengthSq() < 1e-6) _tmp.set(1, 0, 0);
    uMoonRight.value.copy(_tmp).normalize();
    const ph = h ? h.moonPhase : 0.5;
    const illum = 1 - Math.abs(1 - 2 * ph);
    uMoonPh.value.set(ph < 0.5 ? 1 : -1, 1 - 2 * illum, M.earthshine, M.halo);
    uMoonR.value = M.radius;
    const b = M.bright * vis;
    uMoonCol.value.set(M.col[0] * b, M.col[1] * b, M.col[2] * b);
  } else {
    uMoonCol.value.set(0, 0, 0);
  }

  // Published for lighting.js — ambience only, never a Light.
  airAmbience.fog = uFog.value;
  airAmbience.moon = vis;
}

// Published for player.js's undercurrent (game.js wires it): the EASED wind, so the
// drift under the surface re-aims on exactly the same curve the chop above it does.
export function windState() { return _windOut; }
const _windOut = { speed: 0, dx: 1, dz: 0 };

export function updateWater(dt, t) {
  uTime.value = t;
  // THE FLOW LEAN, resolved once a frame for every fogged program (see STYLE_U).
  {
    const hz = styleK('haze'), mt = styleK('matte');
    STYLE_U[0] = 0.65 * hz + AIR_STORM_K * uStormU.value;   // + the storm's spray haze (see K_AIR)       // air: KAIR * (1 + 0.65 hz) -- 1.65x at full lean (2.4x drowned the sea in the sky's colour; 1.8x fogged noon)
    STYLE_U[1] = 0.45 * hz;       // nepheloid amp x1.45 at full lean (silt line structure kept)
    STYLE_U[2] = mt;              // the matte mirror (surface shader, from-above branch only)
    STYLE_U[3] = hz;              // lid ring share, read by skyDrama on the CPU
  }
  // Boil fades over ~1.5 s once the bubbles stop arriving; while a burst is breaching,
  // surfaceBoil() keeps re-feeding it faster than this drains it.
  uBoil.value.z *= Math.exp(-dt / 0.55);
  const y = camera.position.y, d01 = clamp(-y / 900, 0, 1);

  // --- the wind eases; it never snaps. ------------------------------------------
  // Exponential chase, frame-rate independent. Done BEFORE the surface height below,
  // because surfaceHeightAt reads these same uniforms and localSurfaceY has to be the
  // height the vertex shader is about to write, not last frame's.
  {
    const a = 1 - Math.exp(-dt / WIND_TAU);
    _wsp += (_wspT - _wsp) * a;
    _wdX += (_wdTX - _wdX) * a; _wdZ += (_wdTZ - _wdZ) * a;
    const L = Math.hypot(_wdX, _wdZ);
    if (L > 1e-4) { uWindD.value.set(_wdX / L, _wdZ / L); }
    uWindS.value = _wsp;
    const WW = GLASS.windwater;
    uWindK.value.set(WW.anisoK, WW.ampK);
    uCap.value.set(WW.capThr, WW.capK);
    // The chop block, pushed every frame so all nine numbers are live-pokeable. The lag
    // WEIGHTS are resolved here rather than baked, so foamDecay is a knob too; the lag
    // TIMES are compile-time (they set the phase rotations inside the shader).
    const CH = GLASS.chop;
    uChop.value.set(CH.k, CH.foamThr, CH.foamSoft, CH.foamK);
    uChop2.value.set(CH.texScale, CH.streakK, CH.scatterK, CH.scatterPow);
    const td = Math.max(0.2, CH.foamDecay);
    uLagW.value.set(Math.exp(-CHOP_LAGS[0] / td), Math.exp(-CHOP_LAGS[1] / td),
      Math.exp(-CHOP_LAGS[2] / td));
    uChopX.value.set(CH.streakLegacy, CH.foamLagK);
    uGale.value = CH.galeAmp;
    uSss.value.set(CH.sssK, CH.sssPow, CH.sssTau, CH.sssGain);
    uSss2.value.set(CH.sssCap, CH.sssCalm, CH.sssDayLo, CH.sssDayHi);
    uOpaq.value.set(CH.opaqK, CH.opaqLo, CH.opaqHi, CH.opaqFoam);
    uOpaq2.value.set(CH.opaqBelow, CH.opaqSssK);
    uSpill.value.set(CH.spillK, CH.spillLen, CH.spillLip, CH.spillTail);
    uDet.value.set(CH.detailK, CH.detailGain, CH.detailWind, CH.detailBelow);
    uRough.value.set(CH.windMps, CH.roughK, CH.glitterLegacy, CH.glitterK);
    uAccS.value.set(CH.foamStretch, CH.foamLaceScale);
    _windOut.speed = _wsp; _windOut.dx = uWindD.value.x; _windOut.dz = uWindD.value.y;
  }

  // ONE answer to "is the eye in air", against the real surface under the camera, shared
  // by the background dome and the sea's occlusion. Computed first because both read it.
  // uStormU is set further down from wMurk; one frame of lag on the wave amplitude here
  // is invisible and avoids reordering the whole function.
  // THE SPECTRAL OCEAN. The spectrum follows the eased wind and the storm envelope the
  // sky is drawn with (one frame of lag on storm, as before); the GPU then evolves and
  // inverts it, and the probe reads back the drawn height around Sal and the raft.
  setSeaState(_wsp, uStormU.value, uWindD.value.x, uWindD.value.y, t);
  updateOcean(dt, t);
  feedOceanWorker(t);
  oceanTick(dt);
  _surfH = SURFACE_Y + surfaceHeightAt(camera.position.x, camera.position.z, t, uStormU.value);
  // WAVE-SLOPE CAUSTICS (roadmap/ref-caustics-shadow.md). surfaceHeightAt has just
  // resolved _cw for this frame's storm and wind; publish the two longest components
  // (bearing, k, HEIGHT amplitude, omega) plus the clock so terrain.js can evaluate the
  // same low-frequency surface gradient per fragment. Plain floats into a fixed array:
  // no allocation, no import of terrain.js from here.
  dominantComponents(waveLow);
  waveLow[10] = t;
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
  // Base 0.62 -> 0.42 (2026-08-25): 0.62 was set while the reversed smoothstep in
  // buildRays zeroed every billboard, i.e. tuned blind. First live joint tune with
  // the volumetric columns (their intensity 1.05 -> 0.85): billboards as accents.
  uRayFade.value = 0.42 * rayDim * rayBand * (0.82 + 0.18 * Math.sin(t * 0.23));
  rayMesh.visible = uRayFade.value > 0.004;
  updateSunShadow();
  // Ray colour follows the sun disc (the same _pDisc the dome and glitter path use),
  // hue-only: the disc palette normalised by its max component, so noon (near-white)
  // leaves the tuned cool tint untouched while dawn warms the shafts and a storm greys
  // them — the billboards can never disagree with the volumetric columns at a weather
  // stop. Baked cyan literal retired.
  {
    const m = Math.max(_pDisc[0], _pDisc[1], _pDisc[2], 1e-4);
    rayMesh.material.uniforms.uColor.value.set(
      0.36 * _pDisc[0] / m, 0.55 * _pDisc[1] / m, 0.68 * _pDisc[2] / m);
  }
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
  uStormU.value = storm;
  // Clouds, marine layer and moon. After the palette copy above, because every colour it
  // resolves is made out of _pHor/_pDisc, and before anything reads the uniforms.
  skyDrama(dt, storm);
  // The volumetric sky's environment and cloud shadow, for the sea (see GLSL_SEA_SKY).
  {
    const se = getSkyEnv();
    if (se && se.valid && se.texture) { uSkyEnvT.value = se.texture; uSkyEnvK.value = 1; } else uSkyEnvK.value = 0;
    const cs = getCloudShadow();
    if (cs && cs.texture) { uCloudShT.value = cs.texture; uCloudShW.value.set(cs.window[0], cs.window[1], cs.window[2], 1); }
    else uCloudShW.value.w = 0;
  }
  // After skyDrama: every uniform the dome will be captured through is final for this
  // frame. Captures only fire on palette drift — see the SKY ENVIRONMENT MAP block.
  maybeRefreshSkyEnv(dt);
  // The painted disc pow(sd, n) ~ exp(-n th^2 / 2): half-angle at half max is
  // 1.177 / sqrt(n), integrated solid angle 2 pi / (n + 1). These are what the GGX
  // glitter widens by and normalises to, so the lobe tracks the disc through a storm.
  uGlit.value.set(GLASS.chop.glitterDiscK * 1.177 / Math.sqrt(uSunSize.value), 6.2831853 / (uSunSize.value + 1));
  // crepuscular-sky: publish this frame's resolved sky for postfx.skyrays.js.
  skyState.cov = uCloudCov.value;
  skyState.disc[0] = _pDisc[0]; skyState.disc[1] = _pDisc[1]; skyState.disc[2] = _pDisc[2];
  skyState.hor[0] = _pHor[0]; skyState.hor[1] = _pHor[1]; skyState.hor[2] = _pHor[2];
  skyState.discK = uDiscK.value; skyState.fog = uFog.value; skyState.air = uAir.value;
  skyState.lid = cloudLook.lid;

  if (surface.visible) {
    const su = surface.material.uniforms;
    if (su.uFade) su.uFade.value = sFade;   // tolerate a shader built without it
    su.uBright.value = clamp(1 - d01 * 0.6, 0.45, 1) * (0.35 + 0.65 * sFade);
    // The bolt light carries the strike now; the sea's sheet keeps its `sheet` share.
    su.uFlash.value = wFlash * GLASS.lightning.sheet;
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

  // The grit catches the REAL lantern now (it used to be a stand-in 8.5 units ahead of
  // the lens): written in updateAtmosphere, after game.js has placed the flame.

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
  _atmCamY = camY; _atmStorm = storm;
  // The lamp slots and the particulate read the lantern AFTER lighting.js has relit it
  // (relight() scales its intensity and decay per zone), so game.js calls syncLamps()
  // right after updateLighting. The boot/title prime has no lighting pass after it, so
  // it syncs here once; every later frame's call from game.js simply overwrites.
  if (!_lampsWired) syncLamps();
  return _outCol;
}
let _atmCamY = 0, _atmStorm = 1, _lampsWired = false;
// Called by game.js once a frame, AFTER updateLighting (see updateAtmosphere).
export function syncLamps() {
  _lampsWired = true;
  const camY = _atmCamY, storm = _atmStorm;
  uLightPos.value.copy(lanternLight.position);
  updateLamps(camY, storm);
  // The grit's ambient share: the water's own radiance at the camera against the zone-0
  // floor (~0.029 luminance), where the shipped grit was tuned -- so the zone-0 bottom
  // is unchanged and the deep zones fall to a trace. Floored so a flake is never
  // mathematically black, capped so the bright shallows do not overexpose it.
  const aLum = 0.2126 * _outCol.r + 0.7152 * _outCol.g + 0.0722 * _outCol.b;
  uSnowAmb.value.x = clamp(aLum / 0.029, 0.04, 1.25);
  _ambP.r = _outCol.r * 5; _ambP.g = _outCol.g * 5; _ambP.b = _outCol.b * 5;
  uPixP.value = pixScale(renderer, camera);
  {
    // Blend the zone character on the SAME camera-height weights the silt profile uses.
    const t = uTime.value, dt = _snowT < 0 ? 0 : Math.min(0.1, Math.max(0, t - _snowT));
    _snowT = t;
    const t1 = 1 - ms(camY, -400, -300), t2 = 1 - ms(camY, -710, -610);
    const z = uSnowZone.value, A = SNOW_ZONE[0], B = SNOW_ZONE[1], C = SNOW_ZONE[2];
    const k = i => ml(ml(A[i], B[i], t1), C[i], t2);
    z.x += dt * k(0); z.y += dt * k(1); z.z = k(2); z.w = k(3);
  }
  updateParticulate(uTime.value, lanternLight.position, _ambP, camY, ATMOS.bokeh);
  updateSpray(uAir.value, _windOut.speed * ATMOS.spray, _windOut.dx, _windOut.dz, uStormU.value * ATMOS.spray, _pHor);
}

// ---------------------------------------------------------------------------
// THE LAMP IN THE MURK — CPU side. Fills the five lamp uniforms GLSL_LAMP reads.
// Zero allocation: the candidate list is a module array refilled in place by a prebuilt
// traverse callback every 2 s (the sleeper's ward pool and the vent light are built per
// zone), and every position read goes through one scratch vector.
const _lampCands = [];
let _lampScanT = 1e9, _lampLast = 0;
const _lp = new THREE.Vector3();
const _lampCollect = o => {
  if (o.isPointLight && o !== lanternLight && o !== playerLightSrc) _lampCands.push(o);
};
function updateLamps(camY, storm) {
  // Local extinction at the eye, per channel: exactly the density the fog chunk opens
  // its integral with (clear column + silt at the camera, storm gain folded in).
  const n = nephAt(camY), rc = rhoClearAt(camY), sh = nephShape(camY, n);
  LAMPK_U[0] = (rc * K_EXT[0] + sh * K_PART[0]) * storm;
  LAMPK_U[1] = (rc * K_EXT[1] + sh * K_PART[1]) * storm;
  LAMPK_U[2] = (rc * K_EXT[2] + sh * K_PART[2]) * storm;
  // THE ABYSS READS (GLASS.abyss.lampK): the nepheloid ash over the zone-2 plain is the
  // murkiest water in the column, so the flame's glow in it is a larger, brighter volume
  // -- the luminous ground that kelp, reef and animals between it and the lens stand
  // against in silhouette. Eased in over the zone top; 1 = the shipped gain.
  const ak = abyssK(camY);
  LAMPK_U[3] = ATMOS.lampGain * (1 + (GLASS.abyss.lampK - 1) * ak);
  {
    const on = SURFK && SURFK.on ? 1 : 0, pk = SURFK ? SURFK.pathK : 0;
    const d = scene.fog ? scene.fog.density * pk * on : 0;
    // With the surface patch off the light leg falls back to the eye leg's own numbers.
    LAMPP_U[0] = on ? SURFK.path[0] * d : LAMPK_U[0];
    LAMPP_U[1] = on ? SURFK.path[1] * d : LAMPK_U[1];
    LAMPP_U[2] = on ? SURFK.path[2] * d : LAMPK_U[2];
  }
  // In air the scatter would be the marine haze's, three orders thinner: both slots
  // off, and the chunk's whole lamp block is one compare. The lantern also has to be IN
  // the water: on the deck it hangs in air even when the camera dips below a crest.
  const wet = camY < -0.3 && ATMOS.lampOn;
  const L = lanternLight;
  if (wet && L.position.y < 0 && L.intensity > 0.01) {
    LAMPA_U[0] = L.position.x; LAMPA_U[1] = L.position.y; LAMPA_U[2] = L.position.z;
    LAMPA_U[3] = L.intensity;
    LAMPAC_U[0] = L.color.r; LAMPAC_U[1] = L.color.g; LAMPAC_U[2] = L.color.b;
    LAMPAC_U[3] = L.distance > 0 ? L.distance : 60;
  } else LAMPA_U[3] = 0;

  // Slot B: the strongest other submerged point light as seen from the camera.
  const now = performance.now();
  if (now - _lampScanT > 2000 || now < _lampScanT) {
    _lampScanT = now; _lampCands.length = 0; scene.traverse(_lampCollect);
  }
  let best = null, bestS = 0;
  if (wet) {
    const cp = camera.position;
    for (let i = 0; i < _lampCands.length; i++) {
      const o = _lampCands[i];
      if (!o.visible || !(o.intensity > 0.05) || !o.parent) continue;
      o.getWorldPosition(_lp);
      if (_lp.y > -0.5) continue;
      const R = o.distance > 0 ? o.distance : 60;
      const d2 = _lp.distanceToSquared(cp);
      if (d2 > (R + 40) * (R + 40)) continue;
      // A light may carry an authored weight (userData.lampBias: the ENCOUNTER's key light
      // outranks a brighter prop, so the creature keeps the one slot while it is in play).
      const ud = o.userData, bias = ud.lampBias !== undefined ? ud.lampBias : 1;
      const sc = bias * o.intensity * (o.color.r + o.color.g + o.color.b) / Math.max(d2, 4);
      if (sc > bestS) { bestS = sc; best = o; }
    }
  }
  if (best) {
    best.getWorldPosition(_lp);
    LAMPB_U[0] = _lp.x; LAMPB_U[1] = _lp.y; LAMPB_U[2] = _lp.z;
    // Its gain rides on its intensity so the chunk keeps one gain uniform.
    // (userData.scatter scales one light's share: a ward's white-hot flash is a point on the
    // skin, not a lamp in the water, and a creature's cold body glow is mostly in-scatter)
    const us = best.userData.scatter !== undefined ? best.userData.scatter : 1;
    LAMPB_U[3] = best.intensity * us * ATMOS.lampGainB / Math.max(ATMOS.lampGain, 1e-4);
    LAMPBC_U[0] = best.color.r; LAMPBC_U[1] = best.color.g; LAMPBC_U[2] = best.color.b;
    LAMPBC_U[3] = best.distance > 0 ? best.distance : 60;
  } else LAMPB_U[3] = 0;
  _lampLast = best;
}
if (typeof window !== 'undefined') {
  window.__atmos = {
    ATMOS,
    lamps: () => ({ a: Array.from(LAMPA_U), ac: Array.from(LAMPAC_U), b: Array.from(LAMPB_U),
      bc: Array.from(LAMPBC_U), k: Array.from(LAMPK_U), bObj: _lampLast && (_lampLast.name || _lampLast.uuid.slice(0, 8)),
      cands: _lampCands.length }),
    part: particulateState
  };
}

export { clamp };
