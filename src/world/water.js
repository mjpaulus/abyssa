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
vec3 skyRadiance( vec3 d ){
  float up = clamp( d.y, 0.0, 1.0 );
  vec3 c = mix( uSkyHor, uSkyZen, sqrt( up ) );

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
  c += uSunCol * uDiscK * ( pow( sd, uSunSize ) + 0.055 * pow( sd, 14.0 ) ) * occ;

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
export const airAmbience = { fog: 0, moon: 0 };

// Dev surface, namespaced and kept (the convention in CLAUDE.md). `sync()` snapshots the
// live hand/wind off window.weather and installs it, which is what lets a probe FORCE a
// hand — poke __sky.h.fog / .clouds / .moonK and the sky answers on the next frame —
// without weather.js or game.js knowing. Once game.js calls setWeatherHand every frame,
// sync() is just a way to freeze a hand for a screenshot.
if (typeof window !== 'undefined') {
  window.__sky = {
    // The tuning surface itself, so a probe (and the lab) can A/B a stop live.
    G: GLASS,
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
        refrK: uRefrK.value, refrSide: uRefrSide.value, refrSkipped
      };
    },
    // THE INVERSE-MIRROR RESIDUAL, measured without a GPU readback. surfaceForwardAt is
    // literally what the vertex shader does; feeding its world xz back through
    // surfaceHeightAt's fixed point must return the height it wrote. The gap is the
    // honest error every consumer of localSurfaceY() inherits.
    chopResidual(n, storm, t) {
      n = n || 200; storm = storm === undefined ? uStormU.value : storm;
      t = t === undefined ? uTime.value : t;
      const p = { x: 0, y: 0, z: 0 };
      let mx = 0, s2 = 0, dmax = 0;
      for (let i = 0; i < n; i++) {
        const a = i * 2.399963, r = 40 * Math.sqrt(i / n);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        surfaceForwardAt(p, x, z, t, storm);
        dmax = Math.max(dmax, Math.hypot(p.x - x, p.z - z));
        const e = Math.abs(surfaceHeightAt(p.x, p.z, t, storm) - p.y);
        mx = Math.max(mx, e); s2 += e * e;
      }
      return { n, storm, chop: uChop.value.x * Math.max(ms(storm, 0, 0.9), uWindS.value),
        maxDisp: dmax, max: mx, rms: Math.sqrt(s2 / n) };
    }
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
const uStormU = { value: 0 };
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
const GLSL_SKY_DECL = `uniform vec2 uCloudDrift, uSunUV, uCloudFrm2;
uniform float uCloudScale, uCloudCov, uCloudSoft, uCloudTex, uCloudBak, uCloudDome, uDiscK, uMoonR, uFog;
uniform vec3 uCloudLit, uCloudBase, uMoonDir, uMoonRight, uMoonCol, uFogCol;
uniform vec4 uMoonPh, uCloudIsl, uCloudShp, uCloudFrm;`;
// The uniform map half of the same pairing.
const SKY_UNIFORMS = {
  uCloudDrift, uCloudScale, uCloudCov, uCloudSoft, uCloudTex, uCloudLit, uCloudBase, uSunUV, uDiscK,
  uCloudIsl, uCloudShp, uCloudBak, uCloudDome, uCloudFrm, uCloudFrm2,
  uMoonDir, uMoonRight, uMoonCol, uMoonR, uMoonPh, uFog, uFogCol
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
      ...SKY_UNIFORMS
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
  const prevAir = uAir.value;
  uAir.value = 1;
  envCam.update(renderer, envScene);
  uAir.value = prevAir;
  const old = envRT;
  envRT = envPM.fromCubemap(envCubeRT.texture);
  if (old) old.dispose();
  for (let i = 0; i < envListeners.length; i++) envListeners[i](envRT.texture);
  _envFinger[0] = _pHor[0]; _envFinger[1] = _pHor[1]; _envFinger[2] = _pHor[2];
  _envFinger[3] = _pZen[0]; _envFinger[4] = _pZen[1]; _envFinger[5] = _pZen[2];
  envCool = 2.5;
}
function maybeRefreshSkyEnv(dt) {
  if (!envCam) return;
  envCool -= dt;
  if (envCool > 0) return;
  const d = Math.abs(_pHor[0] - _envFinger[0]) + Math.abs(_pHor[1] - _envFinger[1])
          + Math.abs(_pHor[2] - _envFinger[2]) + Math.abs(_pZen[0] - _envFinger[3])
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
           // Reversed-edge smoothstep is GLSL UB (x0 on this driver) — it zeroed vA
           // and killed both snow layers. Fix idiom: 1.0 - smoothstep(lo, hi, x).
           * ( 1.0 - smoothstep( uL * 0.32, uL * 0.5, length( w - uCam ) ) )
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
const uOpaq = { value: new THREE.Vector4(GLASS.chop.opaqK, GLASS.chop.opaqLo, GLASS.chop.opaqHi, GLASS.chop.opaqFoam) };
const uOpaq2 = { value: new THREE.Vector2(GLASS.chop.opaqBelow, GLASS.chop.opaqSssK) };
// SPILLING BREAKERS. (spillK, spillLen, spillLip, spillTail).
const uSpill = { value: new THREE.Vector4(GLASS.chop.spillK, GLASS.chop.spillLen, GLASS.chop.spillLip, GLASS.chop.spillTail) };
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
// MIRRORS THE WIND BIAS EXACTLY. It has to: game.js clamps the play camera against
// localSurfaceY() and the refraction clip plane is placed on it, so if the CPU height
// and the vertex height disagree the eye crosses the interface at the wrong moment and
// the raft rides a swell the water is not making.
//
// THE INVERSE PROBLEM. With the choppy term on, the mesh no longer maps a grid point to
// the column above it: the vertex shader evaluates the field at a PARAMETER point p and
// writes the vertex to (p + D(p), h(p)). "What is the surface height at world (x,z)?"
// is therefore asking for p such that p + D(p) = (x,z), which has no closed form.
//
// The standard answer, and the one used here, is the fixed point p <- (x,z) - D(p) from
// p0 = (x,z). D is a contraction while sum(k_i*A_i)*chop < 1 (the same bound that keeps
// the surface from folding through itself — see GLASS.chop.k), so it converges
// geometrically at that ratio: ~0.65 at full storm, i.e. two iterations leave ~0.65^3 of
// the initial parameter error, and the HEIGHT error is that times |grad h|. Measured
// residual is reported on the card; two iterations is where it stops paying.
//
// Zero-allocation: the per-component wind-biased bearing and amplitude are resolved ONCE
// into _cw and then reused by every iteration and by the final height sum.
// `amp` is the DISPLACEMENT amplitude (shipped, unscaled by the gale) and `ampH` the
// HEIGHT amplitude — see galeAmt() in GLSL_CHOP_DECL. Keeping them separate on the CPU
// too is what makes this an exact mirror rather than a near one.
const _cw = [0, 1, 2].map(() => ({ dx: 0, dz: 0, amp: 0, ampH: 0, k: 0, w: 0 }));
export function surfaceHeightAt(x, z, t, storm) {
  const sm = THREE.MathUtils.smoothstep(storm, 0, 0.90);
  const aK = uWindK.value.x, mK = uWindK.value.y, S = uWindS.value;
  const wx = uWindD.value.x, wz = uWindD.value.y;
  for (let i = 0; i < 3; i++) {
    const c = _wavePhase[i], o = _cw[i];
    const sgn = c.dx * wx + c.dz * wz < 0 ? -1 : 1;
    const k2 = aK * S;
    let dx = c.dx + (wx * sgn - c.dx) * k2, dz = c.dz + (wz * sgn - c.dz) * k2;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    const al = dx * wx + dz * wz, al2 = al * al;
    o.dx = dx; o.dz = dz; o.k = c.k; o.w = c.w;
    o.amp = (c.a0 + (c.a1 - c.a0) * sm)
      * (1 + mK * S * (1 - 0.5 * sm))
      * (1 + S * ((1 - aK) + 2 * aK * al2 - 1));
    // MIRRORS galeAmt(): the two longest components carry the storm swell scale in their
    // HEIGHT only. i >= 2 keeps ampH === amp, and at sm = 0 the factor is exactly 1.
    o.ampH = i < 2 ? o.amp * (1 + (GLASS.chop.galeAmp - 1) * sm) : o.amp;
  }
  // EXACTLY the shader's gate (GLSL_WAVE_V/F): at storm 0 wind 0 this is 0 and every
  // line below collapses to the shipped vertical-only sum.
  const chop = GLASS.chop.k * Math.max(sm, S);
  let px = x, pz = z;
  if (chop > 1e-5) {
    // SIX, up from four, because of the storm swell scale. The fixed point solves for the
    // PARAMETER point and its contraction ratio is untouched by galeAmp (the displacement
    // keeps the shipped amplitude on purpose) — but the HEIGHT error is that parameter
    // error times |grad h|, and grad h is exactly what the gale scales. Measured at
    // galeAmp 1.8, wind 0.9, storm 1: four iterations left max 0.050 u, which is the
    // budget rather than under it; six leave 0.021. The loop early-outs on a converged
    // step, so calm and moderate seas still run the three they always ran, and the whole
    // function is evaluated ONCE A FRAME under the camera, not per vertex.
    for (let it = 0; it < 6; it++) {
      let dX = 0, dZ = 0;
      for (let i = 0; i < 3; i++) {
        const o = _cw[i];
        const c = o.amp * chop * Math.cos((px * o.dx + pz * o.dz) * o.k + t * o.w);
        dX += o.dx * c; dZ += o.dz * c;
      }
      const nx = x - dX, nz = z - dZ;
      const step = Math.abs(nx - px) + Math.abs(nz - pz);
      px = nx; pz = nz;
      // Early out on a converged step. Measured contraction is ~0.48 at full chop, so
      // this normally runs 3 of the 4 and the whole loop is 36 trig calls A FRAME — the
      // function is evaluated once, under the camera, not per vertex. Two iterations left
      // a 0.110 u worst-case height error against the true mesh; four leaves 0.030.
      if (step < 1e-3) break;
    }
  }
  let h = 0;
  for (let i = 0; i < 3; i++) {
    const o = _cw[i];
    h += o.ampH * Math.sin((px * o.dx + pz * o.dz) * o.k + t * o.w);
  }
  return h;
}
// Debug/verification surface: the FORWARD map, i.e. exactly what the vertex shader does.
// Given a parameter point it returns the world xz the mesh puts there and the height it
// writes. surfaceHeightAt(forward) must return that height back — that round trip IS the
// residual measurement, and it needs no GPU readback.
export function surfaceForwardAt(p, x, z, t, storm) {
  const sm = THREE.MathUtils.smoothstep(storm, 0, 0.90);
  surfaceHeightAt(x, z, t, storm);            // fills _cw for this (t, storm, wind)
  const chop = GLASS.chop.k * Math.max(sm, uWindS.value);
  let dX = 0, dZ = 0, h = 0;
  for (let i = 0; i < 3; i++) {
    const o = _cw[i], q = (x * o.dx + z * o.dz) * o.k + t * o.w;
    const c = o.amp * chop * Math.cos(q);
    dX += o.dx * c; dZ += o.dz * c; h += o.ampH * Math.sin(q);
  }
  p.x = x + dX; p.z = z + dZ; p.y = h;
  return p;
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

// Unrolled from JS because GLSL ES 1.00 (what three compiles a plain ShaderMaterial as)
// has no array constructors — `const float A[6] = float[6](...)` is a 3.00-only form.
// `dist` retires each component before the mesh stops resolving it; see WAVE above and
// the ring-spacing note in buildSurfaceGeo.
//
// THE CHOPPY TERM. Each component now also displaces the surface HORIZONTALLY along its
// own bearing: D_i = dw_i * chop * A_i * cos(q_i). Its parameter derivative is
// -A_i k_i chop sin(q_i), which is NEGATIVE at a crest (q = pi/2) and positive in a
// trough — vertices crowd toward the crests and stretch across the backs, which is the
// whole Gerstner trick and the entire difference between a rolling sine sea and the
// steep-fronted one in Michael's poseidon frames. It is the classic form written for
// this field's sin() phase convention (h = A sin(q) is A cos(q - pi/2), so the standard
// -dir*Q*A*sin(theta) becomes +dir*Q*A*cos(q)).
//
// The Jacobian falls out of the same sin/cos pair for free. With s_i = -A_i k_i chop
// sin(q_i), the horizontal displacement's Jacobian is sum(s_i * outer(dw_i, dw_i)) —
// symmetric, three floats — and TWO things read it:
//   * det(I + J) < 1 is the foam birth test (piece 2), and
//   * the true surface normal, because the world-space gradient of a displaced surface
//     is (I + J)^-1 * grad_p h, not grad_p h. Getting this wrong would leave the shading
//     flat on exactly the steep fronts the displacement just built.
// Note trace(J) = sum(s_i) because every dw is a unit vector, which is why the three
// LAGGED compression samples cost one float each instead of three.
function waveSum(n, mode) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const [lam, deg, a0, a1, fr] = WAVE[i];
    const k = 2 * Math.PI / lam, w = DISP * Math.sqrt(k), a = deg * Math.PI / 180;
    const dx = Math.cos(a), dz = Math.sin(a);
    // d0 -> dw: the bearing dragged onto the wind axis, taking whichever SIGN of the
    // wind vector is nearer so a component never has to swing through 180 degrees (and
    // so a beam wind rotates the chop rather than reversing its travel).
    s += `\n  { vec2 d0=${v2([dx, dz])};
    vec2 dw=normalize( mix( d0, uWindD*(dot(d0,uWindD)<0.0?-1.0:1.0), uWindK.x*uWindS ) );
    float al=dot(dw,uWindD); al*=al;
    float amp=mix(${f(a0)},${f(a1)},sm)
      *(1.0+uWindK.y*uWindS*(1.0-0.5*sm))
      *(1.0+uWindS*(mix(1.0-uWindK.x,1.0+uWindK.x,al)-1.0))
      *(1.0-smoothstep(${f(fr * 0.5)},${f(fr)},dist));
    float q=dot(p,dw)*${f(k)}+t*${f(w)};
    float sq=sin(q), cq=cos(q);
    float ampH=amp${i < 2 ? '*gA' : ''};
    h+=ampH*sq;`;
    if (mode === 'v') {
      s += `\n    D+=dw*(amp*chop*cq); }`;
    } else if (mode === 's') {
      // SPILL PROBE: the compression trace and its lags ONLY. trace(J) = sum(s_i)
      // because every dw is a unit vector, so this answers "is/was this parcel
      // folding" for the price of one sin/cos per component — no height, no
      // gradient, no Jacobian inverse, no matrix solve.
      s += `\n    float sc=-amp*${f(k)}*chop;
    tr+=sc*sq;`;
      for (let L = 0; L < CHOP_LAGS.length; L++) {
        const tau = CHOP_LAGS[L];
        s += `\n    t${L + 1}+=sc*(sq*${f(Math.cos(w * tau))}-cq*${f(Math.sin(w * tau))});`;
      }
      s += ` }`;
    } else {
      s += `\n    g+=dw*(ampH*${f(k)}*cq);
    float sc=-amp*${f(k)}*chop;
    float s0=sc*sq;
    jx+=s0*dw.x*dw.x; jc+=s0*dw.x*dw.y; jz+=s0*dw.y*dw.y;`;
      // Lagged compression, exactly: sin(q - w*tau) = sin q cos(w tau) - cos q sin(w tau).
      // The parameter point p labels a water PARTICLE in a Gerstner field, so this is not
      // an approximation of "did this patch fold recently" — it is that question answered.
      for (let L = 0; L < CHOP_LAGS.length; L++) {
        const tau = CHOP_LAGS[L];
        s += `\n    t${L + 1}+=sc*(sq*${f(Math.cos(w * tau))}-cq*${f(Math.sin(w * tau))});`;
      }
      s += ` }`;
    }
  }
  return s;
}
// The gate. chop is EXACTLY mirrored by surfaceHeightAt on the CPU; at storm 0 wind 0 it
// is zero, D is zero, J is zero, det is 1 and every line here is the shipped field.
const GLSL_CHOP_DECL = `uniform vec4 uChop, uChop2; uniform vec3 uLagW; uniform vec2 uChopX;
uniform float uGale;
float chopAmt( float sm ){ return uChop.x*max(sm,uWindS); }
// STORM SWELL SCALE. GLASS.chop.galeAmp, faded in by the SAME storm smoothstep the wave
// amplitudes themselves use, so at storm 0 this is exactly 1.0 and the calm field is
// bit-identical. Applied to the two longest components' HEIGHT (and therefore to grad h)
// and NOT to the Gerstner displacement or the Jacobian — a big swell is long and tall,
// not steep, and keeping sum(k*A)*chop at its shipped value is what keeps the no-fold
// bound, the CPU fixed point's contraction ratio and the foam birth test all unchanged.
float galeAmt( float sm ){ return mix( 1.0, uGale, sm ); }
// THE FOLD TEST, written the only way that is DEFINED.
//
// This block used to ask smoothstep( thr, thr-sf, det ) — a DECREASING ramp expressed by
// putting the high edge first. The GLSL spec says results are undefined when
// edge0 >= edge1, and it means it: measured live in this project's own browser pane, that
// call returns EXACTLY 0.0 for every input, which silently deleted the whole Jacobian
// foam (the live term AND all three lagged terms) with no error and no warning. A gale
// was therefore wearing only the old height-led whitecap and the legacy wind streaks —
// a large part of why the storm read to Michael as "there is no breaking".
//
// 1 - smoothstep(lo, hi, x) is the same function, exactly, and is defined everywhere. On
// a driver where the reversed form happened to work, this is a bit-for-bit no-op.
float foldK( float thr, float sf, float x ){ return 1.0 - smoothstep( thr - sf, thr, x ); }`;
// Vertex pass: the three components the mesh can actually carry as geometry, now with the
// horizontal displacement that steepens their faces.
const GLSL_WAVE_V = `${GLSL_WIND_DECL}
${GLSL_CHOP_DECL}
float waveH( vec2 p, float t, float storm, float dist, out vec2 disp ){
  float sm=smoothstep(0.0,0.90,storm), h=0.0; vec2 D=vec2(0.0);
  float chop=chopAmt(sm), gA=galeAmt(sm);${waveSum(3, 'v')}
  disp=D; return h;
}`;
// Fragment pass: all six, height, the TRUE (displaced) gradient, and the Jacobian foam
// intensity. The gradient is the normal, and the normal is the whole image — it decides
// refraction, reflection and Fresnel at once.
const GLSL_WAVE_F = `${GLSL_WIND_DECL}
${GLSL_CHOP_DECL}
float waveField( vec2 p, float t, float storm, float dist, out vec2 grad, out float foam ){
  float sm=smoothstep(0.0,0.90,storm), h=0.0; vec2 g=vec2(0.0);
  float chop=chopAmt(sm), gA=galeAmt(sm);
  float jx=0.0, jc=0.0, jz=0.0, t1=0.0, t2=0.0, t3=0.0;${waveSum(6, 'f')}
  // det(I + J). Floored well clear of zero: chop is held under the folding bound so the
  // true det cannot reach 0, but a floor is one instruction and it makes the inverse
  // below structurally safe rather than safe-by-argument.
  float det=(1.0+jx)*(1.0+jz)-jc*jc;
  float ds=max(det,0.12);
  grad=vec2( ((1.0+jz)*g.x-jc*g.y)/ds, ((1.0+jx)*g.y-jc*g.x)/ds );
  // FOAM: born where the surface is folding now, kept alive where this parcel folded in
  // the last ~4 s. The lagged samples use the first-order det (1 + trace), which is the
  // same test to the order that matters and costs one float per lag.
  float thr=uChop.y, sf=max(uChop.z,0.02);
  foam=foldK(thr,sf,det);
  float lk=uChopX.y;
  foam=max(foam,lk*uLagW.x*foldK(thr,sf,1.0+t1));
  foam=max(foam,lk*uLagW.y*foldK(thr,sf,1.0+t2));
  foam=max(foam,lk*uLagW.z*foldK(thr,sf,1.0+t3));
  foam*=uChop.w;
  return h;
}`;
// SPILLING BREAKERS — the fold question asked somewhere ELSE.
//
// Michael: "there is no breaking." Foam that only sits on the fold line is a crease,
// not a breaker; the reference's violence is whitewater avalanching DOWN the leading
// face of a collapsing crest. That is TRANSPORT, and the Gerstner field's Lagrangian
// bookkeeping already carries it: a parcel a little UPSLOPE of this fragment that
// folded tau seconds ago shed white water which has since slid downhill to here. So
// the fragment samples the compression at points up its own gradient (+grad h is
// uphill) and reads the LAGGED trace there — near point with the short lag, far point
// with the long one. The band therefore persists and slides down-face as the wave
// advances, with no history texture and no render target, exactly like the foam it
// extends.
//
// Returns (live trace, lag1, lag2, lag3). det(I+J) to first order is 1 + trace, which
// is the same test waveField's lagged samples already use.
const GLSL_FOLD = `vec4 foldTrace( vec2 p, float t, float storm, float dist ){
  float sm=smoothstep(0.0,0.90,storm), h=0.0;
  float chop=chopAmt(sm), gA=galeAmt(sm);
  float tr=0.0, t1=0.0, t2=0.0, t3=0.0;${waveSum(6, 's')}
  return vec4(tr,t1,t2,t3);
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
  renderer.render(scene, camera);
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

function buildSurface() {
  // uSkyZen/uSkyHor/uSunCol/uSunDir/uSunSize/uStorm + SKY_UNIFORMS are the module-scoped
  // the DOME also holds. Shared on purpose: the sky in Snell's window and the sky over
  // the horizon are the same sky, and sharing the uniform is the only way that stays true
  // without a second update path to keep in sync.
  const u = Object.assign(fogUniforms(), {
    uTime, uCam,
    uSunDir: uSunDirU, uSkyZen, uSkyHor, uSunCol, uSunSize, uStorm: uStormU,
    ...SKY_UNIFORMS,
    uFlash: { value: 0 },
    uMirrorK: { value: 1 }, uNearK: { value: 1 }, uFoamThr: { value: 0.34 },
    uBright: { value: 1 }, uFade: { value: 1 },
    uRefr, uRefrK, uRefrSide, uRes,
    uWindD, uWindS, uWindK, uCap, uChop, uChop2, uLagW, uChopX, uGale, uSss, uSss2,
    uOpaq, uOpaq2, uSpill, uBoil
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: u, fog: true, side: THREE.DoubleSide,
    vertexShader: `#include <fog_pars_vertex>
      ${GLSL_WAVE_V}
      uniform float uTime, uStorm; uniform vec3 uCam;
      varying vec3 vW;
      // THE PARAMETER POINT. vW is where the vertex ENDS UP; vP0 is the point of the wave
      // field it came from. With horizontal displacement on, the two are no longer the
      // same, and every wave quantity the fragment shader wants — height, gradient,
      // Jacobian, foam — is a function of the PARAMETER point. Evaluating them at vW.xz
      // instead would shade the surface with a field shifted up to ~1.4 u sideways: the
      // normals would slide off the fronts they belong to and the foam would sit beside
      // the fold instead of on it. World-space patterns (caustics, foam texture, splash
      // lattices, distance) still read vW, because those live in the world.
      varying vec2 vP0;
      void main(){
        vec3 p = position;
        float dist = length( position.xz );         // polar disc: the local radius IS r
        p.x += uCam.x; p.z += uCam.z;               // the surface follows the diver
        vP0 = p.xz;
        vec2 disp;
        float wh = waveH( p.xz, uTime, uStorm, dist, disp );
        p.x += disp.x; p.z += disp.y;
        p.y += ${f(SURFACE_Y)} + wh;
        vW = p;
        vec4 mvPosition = viewMatrix * vec4( p, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `#include <fog_pars_fragment>
      ${GLSL_NOISE}
      ${GLSL_WAVE_F}
      ${GLSL_FOLD}
      uniform float uTime, uBright, uFade, uStorm, uSunSize, uMirrorK, uNearK,
                    uFoamThr, uFlash, uRefrK, uRefrSide;
      uniform vec2 uCap, uOpaq2;
      uniform vec4 uSss, uSss2, uOpaq, uSpill, uBoil;
      uniform vec3 uCam, uSunDir, uSkyZen, uSkyHor, uSunCol;
      ${GLSL_SKY_DECL}
      uniform sampler2D uRefr;
      uniform vec2 uRes;
      varying vec3 vW;
      varying vec2 vP0;      // the wave-field parameter point — see the vertex shader

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

      // THE STOCHASTIC SPLASH FIELD — the AIR side's rain, and the only thing that
      // replaces rainRing above. rainRing is untouched and still owns the from-below
      // lens, where a lattice is invisible because you see the rings edge-on through the
      // interface. From an eye 1.6 units over the water it was the tell: one ring, dead
      // centre, in every cell of a square grid, all the same size, all beating on one
      // clock. Three independent breaks, all off ONE hash (no extra noise samples — the
      // three streams are fract() of the same value against incommensurate multipliers):
      //   1. CENTRE JITTER. The strike lands anywhere in the middle 44% of its cell.
      //      Jitter alone is not enough — a jittered grid still has one strike per cell,
      //      and the eye reads the DENSITY as periodic even when the positions are not.
      //   2. DEAD CELLS. splashDead of them never fire at all, so the spacing between
      //      live strikes is irregular and there is no period to lock onto.
      //   3. PER-CELL BEAT. Rate AND phase vary per cell, so neighbours never fire
      //      together; the field never pulses as a sheet.
      // Amplitude and reach vary per cell too, which is what stops the surviving rings
      // reading as one rubber stamp. Reach is capped so jitter + radius + the ring's own
      // tail stays inside the cell: a ring must never be clipped by its cell wall (a
      // clipped arc is a straight edge, and a straight edge is a lattice you can see).
      // Called on TWO lattices whose scales are not a small integer ratio and whose fine
      // one is ROTATED, so the two grids share no axis and their beat frequencies do not
      // resolve. Cost: identical to rainRing (one h21, one exp, one length per call).
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
        vec2 dh; float foamJ;
        // Evaluated at the PARAMETER point, and dh comes back already pushed through
        // the inverse Jacobian, so it is the true world-space slope of the displaced
        // surface. At chop 0 the inverse is the identity and this is the shipped value.
        float waveY = waveField( vP0, uTime, uStorm, dist, dh, foamJ );

        // Which side of the interface this fragment is seen from, decided BEFORE the rain
        // so the two sides can run different rain and neither pays for the other's. The
        // rain gradient this drops is O(0.002) against a wave gradient that reaches
        // O(0.5), so the sign it would have flipped is a fragment already exactly edge-on.
        vec3 N = normalize( vec3( -dh.x, 1.0, -dh.y ) );
        // The camera really does cross the interface — player.js clamps the swim ceiling
        // to y = -1.2 and game.js adds up to +2.4 of camera lift, so at the raft this
        // plane is above the eye. Flipping the normal is what the old abs(dot(V,N)) was
        // standing in for; doing it properly also lets the from-above case be right.
        bool below = dot( V, N ) > 0.0;

        // Reference wave height and gradient for THIS sea state — the scale every
        // "how tall / how steep is this fragment" question is asked against. Hoisted
        // above the interface branch because the broad-body SSS (air side) needs it too.
        // Both carry the storm swell scale: galeAmt() multiplies the two longest
        // components' height and their contribution to grad h, so if these did not follow
        // it the thin/tall gates would simply stop firing once the swell grew.
        float gG = mix( 1.0, uGale, smoothstep( 0.0, 0.90, uStorm ) );
        float hRef = 0.58 + 1.24 * uStorm * gG, gRef = 0.075 + 0.24 * uStorm * gG;

        // ---- CHURNED-WATER OPACITY ---------------------------------------
        // Michael's reference storm sea is a WALL. Ours reads as thin glass because
        // the transmission term is a real screen-space render of the far side, and a
        // real render is a real image no matter how hard the water is churning. So
        // the IMAGE'S WEIGHT fades with sea state: entrained bubbles under a gale
        // scatter the transmitted ray out within centimetres, and what is left is the
        // water's own body plus what scatters back out of it. THICK, not black — the
        // analytic body and the broad-body SSS are what remain, which is precisely
        // the pair that was already underneath the refraction mix.
        //
        // ANCHOR: at storm 0 wind 0, churn is smoothstep(lo,hi,0) = 0 and foamJ is
        // exactly 0 (chop 0 -> det 1), so opq is exactly 0 and every transmission
        // line below is bit-identical to what shipped.
        float churn = smoothstep( uOpaq.y, uOpaq.z, max( uStorm, uWindS ) );
        float opq = clamp( uOpaq.x * max( churn, uOpaq.w * foamJ ), 0.0, 1.0 );

        // ---- SPILLING BREAKERS -------------------------------------------
        // Whitewater shed by a fold UPSLOPE of here, avalanched down to this
        // fragment. See GLSL_FOLD. Two probes up the wave's own gradient, read at the
        // two lags that match the time the water needed to get down here; the near
        // one is denser (fresh, at the lip), the far one thinner (older, downslope).
        // Biased onto the LEADING face — waves travel downwind, so the face pointing
        // downwind is the one that collapses forward.
        float spill = 0.0;
        if ( uSpill.x > 0.001 && max( uStorm, uWindS ) > 0.02 ) {
          float gl = length( dh );
          if ( gl > 1e-4 ) {
            vec2 up = dh / gl;                       // +grad h points UPHILL
            float L = uSpill.y * ( 0.45 + 0.55 * gG ) * ( 0.35 + 0.65 * uStorm );
            float thr = uChop.y, sf = max( uChop.z, 0.02 );
            vec4 fA = foldTrace( vP0 + up * ( L * 0.45 ), uTime, uStorm, dist );
            vec4 fB = foldTrace( vP0 + up * L,           uTime, uStorm, dist );
            float sA = foldK( thr, sf, 1.0 + fA.y );   // lag 1: 1.35 s
            float sB = foldK( thr, sf, 1.0 + fB.z );   // lag 2: 2.70 s
            // Leading-face gate. Soft, and never fully closed on the back: a real
            // crest throws some water over its own shoulder.
            float fw = 0.25 + 0.75 * smoothstep( -0.20, 0.45, dot( -up, uWindD ) );
            // The SAME decay weights the lingering fold-foam uses (uLagW = exp(-tau/
            // foamDecay)): whitewater that slid this far down the face is that much
            // older, so it has had exactly that long to dissolve. Without them the
            // spill measured ~3x the coverage of the fold-born foam it extends, which
            // is a sheet, not an avalanche.
            spill = uSpill.x * fw * max( uSpill.z * uLagW.x * sA, uSpill.w * uLagW.y * sB );
          }
        }

        float rain = 0.0;            // from-below lens, unchanged
        float splashV = 0.0;         // air-side splash fleck
        vec2 dhSpl = vec2( 0.0 );    // kept separate: the air side wants less of it
        if ( uStorm > 0.02 ) {                       // uniform branch, fully coherent
          // Only inside 26 units, because past that a strike is under a pixel and all it
          // can do is alias. rk is the SAME intensity drive both sides read.
          float rk = uStorm * uNearK * ( 1.0 - smoothstep( 6.0, 26.0, dist ) );
          vec2 g1, g2;
          if ( below ) {
            // Cells of 0.45 and 0.22 units (1.4 m and 0.7 m), so a ring reads as a drop
            // strike and not as a porthole. THE LENS IS FINE — do not touch it.
            float r1 = rainRing( vW.xz * 2.2, uTime, 0.0, g1 );
            float r2 = rainRing( vW.xz * 4.5, uTime * 1.27, 11.0, g2 );
            dh += ( g1 * 0.0022 + g2 * 0.0011 ) * rk;
            rain = ( r1 + 0.6 * r2 ) * rk;
          } else {
            // Two lattices, the fine one rotated so they share no axis. See splash().
            vec2 pf = vW.xz * ${f(GLASS.rain.splashScales[1])};
            pf = vec2( pf.x * ${f(Math.cos(GLASS.rain.splashRot))} - pf.y * ${f(Math.sin(GLASS.rain.splashRot))},
                       pf.x * ${f(Math.sin(GLASS.rain.splashRot))} + pf.y * ${f(Math.cos(GLASS.rain.splashRot))} );
            float s1 = splash( vW.xz * ${f(GLASS.rain.splashScales[0])}, uTime, 0.0, g1 );
            float s2 = splash( pf, uTime * 1.31, 11.0, g2 );
            dhSpl = ( g1 * 0.0030 + g2 * 0.0016 ) * rk;
            splashV = ( s1 + 0.7 * s2 ) * rk;
          }
        }

        // SURFACE BOIL, geometry half: expanding ripple rings radiating from the breach
        // point, folded into dh BEFORE the normal re-forms so both sides of the
        // interface see the water disturbed, not just repainted. Two rings on
        // incommensurate clocks so the boil churns instead of pulsing.
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

        // Re-formed with the from-below lens folded in (the air side left dh alone and
        // carries its splash in dhSpl, applied in its own branch below).
        N = normalize( vec3( -dh.x, 1.0, -dh.y ) );
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
        // The marine layer's reach across the SEA. Stays 0 on the from-below path, so
        // the underwater half of this shader cannot be touched by the fog beat at all.
        float airK = 0.0;
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
            // THE FROM-BELOW WINDOW THICKENS ONLY PARTLY (uOpaq2.x =
            // GLASS.chop.opaqBelow, flagged for Michael). Physically bubbles do not
            // care which way the light travels and this should match the air side;
            // gameplay does care — Snell's window is the diver's only wayfinding near
            // a storm ceiling and losing the raft through it is a worse frame than a
            // slightly-too-clear one. 0.35 murks the ceiling without deleting it.
            float rk = uRefrK * ( 1.0 - uRefrSide ) * ( 1.0 - opq * uOpaq2.x );
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
          // The air side's rain is dhSpl — the stochastic splash field, not rainRing's
          // lattice (see splash()). dh here is the pure wave gradient: the from-below
          // lens was never added on this path, so nothing has to be subtracted back out.
          vec2 dhA = dh + dhSpl + rippleGrad( vW.xz, uTime, uStorm, dist );
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
          // ...and it closes as the sea churns. (1 - opq) is the whole of Michael's
          // opacity note: at storm 1 / wind 0.9 this weight is 0 and the sea from the
          // deck is body + scatter with no transmitted image in it at all. The
          // analytic body underneath is unchanged, so the sea goes THICK, not black.
          float rk = uRefrK * uRefrSide * ( 1.0 - opq );
          if ( rk > 0.001 ) {
            float ok; vec3 rs = refrSample( T, V, dhA, ok );
            body = mix( body, mix( rs, body, 0.15 ), rk * ok );
          }
          col = body * ( 1.0 - F )
              + skyRadiance( reflect( V, Na ) ) * F;

          // ---- BROAD-BODY SUBSURFACE SCATTERING ---------------------------
          // The single dominant effect in Michael's poseidon reference: sunlight that
          // entered the back of a swell, scattered through its MASS, and leaves the
          // front as turquoise. Not a rim — a body. The dusk crest term further down is
          // the narrow specialisation of the same physics and the two stack; this one is
          // wide, and it is strongest exactly where that one is dead (a high sun).
          //
          // THREE FACTORS, in the order the physics writes them:
          //  1. PATH THROUGH THE WATER. The higher a fragment sits on its own wave the
          //     more lit mass is behind it, so the drive is h01 — the wave's own height
          //     normalised by hRef — biased upward by sssPow. It is the wave's own
          //     height, not the world height, so this reads the same on a calm swell and
          //     a gale crest and never becomes a flat altitude wash.
          //  2. HOW MUCH LIGHT THERE IS TO TRANSMIT. sin(solar elevation), over the
          //     sssDayLo..sssDayHi gate, and NOTHING ELSE.
          //     NOT the disc luminance, which is what the dusk rim term gates on and what
          //     this term was first written to copy. That was a measured bug: uSunCol is
          //     the DISC stop, the storm blend collapses it to [0.42,0.46,0.42], and the
          //     rim term's smoothstep(0.50, 1.10, lum) therefore reads ZERO in a full
          //     gale — the term switched itself off in precisely the weather it exists
          //     for, and A/B banding across the whole frame measured a 0.3 code-value
          //     difference. A storm dims the DISC because the sun is behind cloud; the
          //     LIGHT still arrives, and a bright sunlit storm is the entire reference.
          //     The moon is excluded by elevation instead: sssDayLo sits above the
          //     elevNight floor (8 deg, sin 0.139), so night is exactly zero and dusk
          //     (12 deg, sin 0.208) is near it, which is correct — dusk belongs to the
          //     rim term and this one has no business there.
          //  3. GEOMETRY. Broad on purpose: a floor of 0.30 for any across-the-swell
          //     view, rising to 1.0 looking toward the sun, times a grazing term, because
          //     transmitted light leaves a wave sideways and a top-down view sees the
          //     column, not the glow. No pow() lobe — that is what makes the dusk term a
          //     wire and this one a body.
          //
          // Weighted by (1 - F). Transmitted light arrives where the surface TRANSMITS,
          // which is both physically correct and the bloom guard: on the grazing horizon
          // fragments, where the reflected sky already sits at ~0.6 scene-linear, F is 1
          // and this contributes exactly nothing. Nothing new crosses 0.28.
          if ( uSss.x > 0.001 ) {
            float dayS = smoothstep( uSss2.z, uSss2.w, uSunDir.y );
            if ( dayS > 0.002 ) {
              float h01 = clamp( waveY / max( hRef, 1e-3 ) * 0.5 + 0.5, 0.0, 1.0 );
              vec2 sxz2 = uSunDir.xz;
              float sl2 = length( sxz2 );
              float tw = sl2 > 1e-3 ? dot( normalize( V.xz ), sxz2 / sl2 ) : 0.0;
              float viewS = ( 0.30 + 0.70 * ( 0.5 + 0.5 * tw ) )
                          * ( 0.35 + 0.65 * ( 1.0 - abs( V.y ) ) );
              // Sea-state scale, floored at sssCalm — the calm anchor. Reads the SAME
              // max(storm, wind) drive the chop gate does, so a windy fair day glows too.
              float seaS = uSss2.y + ( 1.0 - uSss2.y )
                         * smoothstep( 0.0, 0.85, max( uStorm, uWindS ) );
              // Broad in DEPTH as well: the reference glows to the horizon. The dusk rim
              // retires at 240; this holds to 430, where the sea is airlight anyway.
              // OPACITY LIFT. As the window closes, the light that used to come
              // through the sea has to come OUT of it instead — that is what an
              // opaque churned sea actually is. 1 + opaqSssK*opq, so calm (opq = 0)
              // is untouched to the bit and a full gale glows half again as hard.
              float amt = pow( h01, uSss.y ) * dayS * viewS * seaS
                        * ( 1.0 + uOpaq2.y * opq )
                        * ( 1.0 - smoothstep( 220.0, 430.0, dist ) ) * uNearK * uSss.x;
              // THE HUE IS DERIVED. fogColor is the palette's own surface irradiance;
              // exp(-K_EXT * tau) is what this game's water does to light passing through
              // it. Green-teal irradiance times a spectrum whose red dies and whose green
              // and blue survive in near-equal measure IS the reference's turquoise.
              // The ceiling is a SCALAR RESCALE, never a per-channel min(): clamping the
              // channels independently is what turns a turquoise into a white the moment
              // two of them saturate, and it did exactly that on the first build (a full
              // whiteout of the gale, measured and screenshotted). Dividing the whole
              // vector by its own peak keeps the derived hue whatever the ceiling is.
              vec3 sssRaw = fogColor * exp( -${v3(K_EXT)} * uSss.z ) * uSss.w;
              float sMax = max( sssRaw.r, max( sssRaw.g, sssRaw.b ) );
              vec3 sssCol = sssRaw * ( sMax > uSss2.x ? uSss2.x / sMax : 1.0 );
              // sqrt of the transmittance, not the transmittance. (1 - F) alone is the
              // literal Fresnel weight and it measured almost nothing: across the open
              // sea the view is grazing, F runs 0.8-1.0, and a 20x crank on sssK moved
              // the band by 1.4 code values. The literal factor is also only half the
              // physics — light leaving at a grazing angle travelled a LONGER path
              // through the lit body on the way out, so the internal radiance it carries
              // is correspondingly higher, and the two effects partly cancel. sqrt is the
              // cheap stand-in for that cancellation. It keeps the property the bloom
              // argument actually needs: still exactly 0 at F = 1, so the horizon
              // fragments, where the reflected sky already sits near 0.6 scene-linear,
              // gain nothing at all.
              // BLOOM. The TERM is capped at sssCap (0.18), comfortably under
              // BloomEffect's 0.28, which is the rule this pass was given.
              //
              // A HEADROOM clamp -- only ever spending what a fragment still has under
              // 0.28 -- was built first and measured, because it is a strictly stronger
              // guarantee. It is unusable here, and the measurement says why: in a bright
              // gale the sea band already renders at 155-168 code values, i.e. 0.33-0.39
              // scene-linear, because the reflected storm sky puts it there. The headroom
              // is ALREADY ZERO across most of the sea, so that clamp deleted the effect
              // over exactly the water it was written for and left +2.4 code values.
              // The sea being over threshold in a gale is a pre-existing property of the
              // sky reflection, not something this term introduces.
              col += sssCol * clamp( amt, 0.0, 1.0 ) * sqrt( max( 1.0 - F, 0.0 ) );
            }
          }

          // Wind streaks: storm foam blown into lines along the dominant swell's own
          // bearing (WAVE[0], 20 degrees), sampled ~9:1 anisotropically so it reads as
          // streaks and not as blobs. Two octaves multiplied, so the streaks break up
          // instead of running the length of the frame.
          if ( uStorm > 0.02 ) {
            vec2 wr = vec2( vW.x * 0.93969 + vW.z * 0.34202,
                           -vW.x * 0.34202 + vW.z * 0.93969 );
            float sk = vn( vec2( wr.x * 0.030 - uTime * 0.30, wr.y * 0.27 ) )
                     * vn( vec2( wr.x * 0.075 - uTime * 0.52, wr.y * 0.62 ) + 3.7 );
            // uLagW.z is GLASS.chop.streakLegacy — 1.0 is the shipped look, exactly.
            // It is a knob because this block and the Jacobian foam below now draw the
            // same thing two different ways: this one paints straight unbroken bands
            // along WAVE[0]'s fixed 20-degree bearing whether or not the water there is
            // folding, and in a gale from height it reads as corduroy under the fold-born
            // foam. Michael's call which wins; nothing here changes without his poke.
            col = mix( col, foamCol, smoothstep( 0.16, 0.42, sk ) * uStorm * uStorm * 0.55
                     * ( 1.0 - smoothstep( 90.0, 260.0, dist ) ) * uChopX.x );
          }
          // The disc stops at 460 units; the sea does not. Its last 30% eases into the
          // same airlight the dome draws past the rim and the fog chunk converges on, so
          // the three meet with no ring. Applied after the foam block below, or a storm
          // whitecap at 400 units would sit on top of the horizon haze.
          rimK = smoothstep( 320.0, 455.0, dist );
          // The raft floats in white: water within a few units of the eye keeps its own
          // colour, everything past ~220 units is gone. Same curve the eye reads on a
          // real fog morning — the sea does not vanish under you, it vanishes around you.
          airK = smoothstep( 6.0, 220.0, dist );
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

        // JACOBIAN FOAM — this ABSORBS the wind round's height-led whitecap term.
        //
        // The old gate asked "is this fragment tall AND steep?", which is a proxy for
        // breaking; this asks the actual question. det(I + dD/dp) is the local area
        // scale factor of the surface: exactly 1 where the water is undisturbed, above 1
        // on the stretched backs, and below 1 where the water crowds — which is where a
        // real sea makes foam. It tracks a front through its whole life instead of
        // flashing on the peak, and because foamJ carries three LAGGED samples of the
        // same determinant (see waveField), foam BUILDS on the fold and DECAYS over
        // ~4 s behind it, with no render target and no history texture.
        //
        // The wind gate survives as a BRIGHTENER, not as the source: folds make foam at
        // any wind, a gale makes more of it.
        //
        // Written AFTER the Fresnel composite and outside the below/air branch, so a cap
        // reads from the deck and from three units under looking up through the
        // interface — the same torn white on both sides, which is the whole point of the
        // interface being one shader.
        //
        // Scene-linear discipline: the colour is HARD CLAMPED at 0.26, under
        // BloomEffect's 0.28. The storm foam above deliberately crosses it (it is the one
        // thing on a storm ceiling that glows); FOAM NEVER DOES, or a gale becomes a
        // field of fireworks. Desaturated white-green rather than the foam's blue-white:
        // torn water carries the sea's own colour in it, not the sky's.
        // The spill joins the fold-born foam HERE, before the texture, so an
        // avalanche is torn by exactly the same procedural lace as the crest that
        // shed it — and because the texture closes its own holes in proportion to
        // the intensity, the band is solid at the lip and ragged at the tail for
        // free. max(), not add: whitewater does not stack.
        float fj = max( foamJ, spill ) * ( 1.0 - smoothstep( 130.0, 330.0, dist ) ) * uNearK;
        if ( fj > 0.003 ) {
          // PROCEDURAL FOAM TEXTURE. Three octaves of the same value noise everything
          // else here is made of, in a wind-aligned frame: advected downwind so the
          // pattern travels with the weather, and STRETCHED along the wind as it rises so
          // foam turns from patches into streaks in a gale. The texture cuts holes in the
          // foam (smoothstep on the pattern) rather than just dimming it — flat foam
          // reads as paint, and paint is what the old term looked like up close.
          vec2 wr = vec2( vW.x * uWindD.x + vW.z * uWindD.y,
                         -vW.x * uWindD.y + vW.z * uWindD.x );
          float st = 1.0 + uChop2.y * uWindS;
          vec2 fp = vec2( ( wr.x - uTime * ( 0.30 + 1.20 * uWindS ) ) / st, wr.y ) * uChop2.x;
          float ft = vn( fp ) * 0.60
                   + vn( fp * 2.30 + 4.1 ) * 0.27
                   + vn( fp * 5.10 - 2.7 ) * 0.13;
          // Denser foam closes its own holes: a fresh fold is solid white, a decaying
          // one breaks into lace. One multiply, and it is most of the "lingering" read.
          float fm = smoothstep( 0.30, 0.74, ft * ( 0.50 + 0.90 * fj ) );
          float capW = smoothstep( uCap.x, min( 0.98, uCap.x + 0.30 ), uWindS );
          vec3 capCol = vec3( 0.90, 1.00, 0.94 )
                      * min( dot( fogColor, vec3( 0.36, 0.50, 0.34 ) ) * 4.6, 0.26 );
          col = mix( col, capCol,
                     clamp( fj * fm * uCap.y * ( 0.55 + 0.65 * capW ), 0.0, 0.90 ) );
        }

        // SURFACE BOIL, colour half: a churning white patch where Sal's exhaust breaks
        // the surface. Written OUTSIDE the below/air branch, like the Jacobian foam, so
        // the same boil reads from the deck looking down and from three units under
        // looking up. Fast fine lace (two octaves on hostile clocks) cut by smoothstep
        // so it seethes as holes open and close, not a painted disc. foamCol keeps the
        // scene-linear discipline: clamped at 0.85 like the storm foam mix above.
        if ( uBoil.z > 0.004 ) {
          vec2 bdc = vW.xz - uBoil.xy;
          float blc = length( bdc );
          if ( blc < uBoil.w ) {
            float bA = clamp( uBoil.z, 0.0, 1.0 );
            float bk = 1.0 - smoothstep( 0.0, uBoil.w, blc );
            float bn = vn( vW.xz * 6.5 + vec2( uTime * 1.9, -uTime * 2.4 ) ) * 0.6
                     + vn( vW.xz * 13.0 - vec2( uTime * 3.3, uTime * 2.1 ) ) * 0.4;
            float bw = bA * bk * smoothstep( 0.26, 0.72, bn * ( 0.55 + 0.95 * bk * bA ) );
            col = mix( col, foamCol, clamp( bw, 0.0, 0.85 ) );
          }
        }

        // BACKLIT CREST SCATTER. A wave top is thin, and when the sun is low and BEYOND
        // it the light that gets through is the green the water leaves — the one moment
        // this sea is lit from inside rather than from above. Three gates, all of which
        // must open: the sun low (dead at noon, full at the dawn/dusk ring stops), the
        // view pointed at it in the horizontal plane (that is what "beyond the crest"
        // means for a surface you are looking across), and the fragment thin — high on
        // its own crest AND steep, which is the top of a front and nothing else.
        // Night costs nothing: uSunCol is black then, so the whole term is zero.
        // Air side only. Under the surface the sun already arrives through Snell's
        // window and the mirror; a second transmission term there would double-count it.
        if ( !below && uChop2.z > 0.001 ) {
          float lum = dot( uSunCol, vec3( 0.2126, 0.7152, 0.0722 ) );
          // uSunCol is the DISC stop, and at night the disc is the MOON — luminance 0.34
          // against noon's 2.9 and dawn/dusk's ~1.9. Without this gate a moonlit gale
          // still put a measured 5 code values of green on 65 pixels, which is not "zero
          // at night", it is "invisible at night". The sun has to actually be up: the
          // sea is not backlit by the moon, and moonlight has no green to give.
          float sunUp = smoothstep( 0.50, 1.10, lum );
          float lowSun = ( 1.0 - smoothstep( 0.08, 0.45, uSunDir.y ) ) * sunUp;
          vec2 sxz = uSunDir.xz;
          float sl = length( sxz );
          float toward = sl > 1e-3 ? max( dot( normalize( V.xz ), sxz / sl ), 0.0 ) : 0.0;
          float thin = smoothstep( 0.42, 1.00, waveY / hRef )
                     * smoothstep( 0.45, 1.25, length( dh ) / gRef );
          float sc = uChop2.z * lowSun * pow( toward, uChop2.w ) * thin
                   * ( 1.0 - smoothstep( 60.0, 240.0, dist ) ) * uNearK;
          // 0.20 ceiling on the emitted colour: transmitted light is dimmer than the
          // source by construction, and the sum must stay under BloomEffect's 0.28.
          col += vec3( 0.18, 0.66, 0.46 ) * clamp( sc, 0.0, 1.0 ) * min( lum * 0.62, 0.20 );
        }
        // From below the LENS is the effect and the fleck is a garnish. From above the
        // splash fleck is back — it was muted to zero only because the field it drew was
        // a regular lattice — at splashK, which puts a full-gale splash at ~0.066
        // scene-linear against BloomEffect's 0.28. Rain never glows.
        col += foamCol * ( below ? rain * 0.25 : splashV * ${f(GLASS.rain.splashK)} );
        col += vec3( 0.72, 0.80, 0.92 ) * uFlash * 0.30 * uNearK;
        if ( rimK > 0.0 ) col = mix( col, airLight( fogColor ), rimK );
        // AFTER the rim hand-off, so the sea, the dome past its rim and the horizon all
        // white out together and the seam stays a seam of nothing.
        if ( airK > 0.0 ) col = airFog( col, 0.0, airK );

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

// ---------------------------------------------------------------------------
// SKY DRAMA — clouds, the marine layer and the moon, resolved on the CPU once a frame
// and written into the uniforms skyRadiance()/airFog() read. Everything expensive is
// here rather than in the shader: colours, the moon's placement and the cloud
// advection are a few dozen ops a frame, against a dome-full of fragments.
//
// ZERO ALLOCATION: the two colour scratch arrays are module-scoped, and the uniforms
// are Vector2/3/4 objects written with .set(). No trig in here beyond one sin/cos pair
// for the wind and one for the moon.
const _cLit = [0, 0, 0], _cBase = [0, 0, 0], _ember = [0, 0, 0];

// Published for world/clouds.js: the SAME two colours the painted dome mixes between,
// plus the backlit amount and the storm envelope. The instanced puffs are lit by the
// palette exactly the way the dome is — that is the whole reason the two read as one
// sky rather than as two cloud systems. `lit`/`base` are the LIVE uniform vectors, so
// there is nothing to keep in sync and nothing copied per frame.
export const cloudLook = {
  lit: uCloudLit.value, base: uCloudBase.value, bak: 0, storm: 0, dome: 1
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
    _windOut.speed = _wsp; _windOut.dx = uWindD.value.x; _windOut.dz = uWindD.value.y;
  }

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
  // Base 0.62 -> 0.42 (2026-08-25): 0.62 was set while the reversed smoothstep in
  // buildRays zeroed every billboard, i.e. tuned blind. First live joint tune with
  // the volumetric columns (their intensity 1.05 -> 0.85): billboards as accents.
  uRayFade.value = 0.42 * rayDim * rayBand * (0.82 + 0.18 * Math.sin(t * 0.23));
  rayMesh.visible = uRayFade.value > 0.004;
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
  // After skyDrama: every uniform the dome will be captured through is final for this
  // frame. Captures only fire on palette drift — see the SKY ENVIRONMENT MAP block.
  maybeRefreshSkyEnv(dt);

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
