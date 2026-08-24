// Day/night cycle + storms. OWNED BY: weather agent.
//
// Contract with game.js:
//   initWeather()          — once at world build.
//   updateWeather(dt, t)   — every frame (even behind the title). Returns (reused):
//     {
//       day: 0..1     — daylight factor. 1 = high noon, 0 = deep night. Full cycle
//                       ~12 real minutes, dawn/dusk transitions ~90s each.
//       storm: 0..1   — storm intensity envelope. 0 calm. Rises over ~20s, holds
//                       60-120s, releases. One storm roughly every 5-9 minutes,
//                       never in the first 3 minutes of a session.
//       flash: 0..1   — lightning flash impulse this frame (storm only), for the
//                       shallows to catch as a brief silver flicker.
//       hand: {...}   — THE DAY HAND, re-dealt once per day index (see dealHand).
//                       fog, fogBurn, clouds, cloudTex, stormDay, stormAt, stormLen,
//                       stormPeak, sunsetDrama, moonK, moonPhase, windBase,
//                       windDir0, windLead, dayIndex.
//       wind: {speed 0..1, dir radians}
//       dayIndex      — integer day, respects PHASE0; scrub/day() move it coherently.
//     }
// STORMS ARE NOW AN EVENT, not a metronome: ~1 day in 3 deals one, and it fires at
// that day's dealt hour. Calm days carry no storm at all.
// Consumers (wired in game.js by the orchestrator): lighting STOPS + water optics
// scale with day/storm in the top zone, raft swell amplitude with storm, ambient
// current with storm, and the pump sputters near storm peak.
//
// Everything here is a pure function of elapsed time t (never Date.now), so a session
// replays identically and a dev helper can scrub the clock forward.
import * as THREE from 'three';
import { scene, camera } from '../core.js';
import { SURFACE_Y, GLASS, setSun, setSkyPhase } from '../config.js';

// THE RETURNED STATE IS ONE REUSED OBJECT (`env` included). Never hold it across a
// frame, never mutate it from a consumer.
//   sunElev/sunAzim  degrees; pure functions of time-of-day, fed to setSun().
//   phase01          0 = midnight, 0.5 = noon.
//   ring             0..4 on night->dawn->noon->dusk; 2 = noon EXACTLY.
//   env              the ONE storm envelope every consumer reads instead of raw
//                    storm: {sky, sea, below}, each 0..1. Sky leads, sea trails,
//                    below lags ~8s, so weather visibly arrives from above; at a
//                    steady state all three converge on the same number, which is
//                    what makes "surface and subsurface move together" checkable.
//                    Daylight is NOT folded in here on purpose — a lagged day would
//                    desync the palette from the sun that is casting it.
//   hand             THE DAY HAND — the cached, per-day-index deal (see dealHand).
//                    Re-dealt only when the day index changes; zero per-frame cost.
//   wind             {speed 0..1, dir radians}. Leads storms, gusts, lulls overnight.
const st = {
  day: 1, storm: 0, flash: 0,
  sunElev: GLASS.sun.elevNoon, sunAzim: GLASS.sun.azimCenter,
  phase01: 0.5, ring: 2,
  dayIndex: 0,
  env: { sky: 0, sea: 0, below: 0 },
  hand: null,        // set by dealHand — the reused HAND object
  wind: { speed: 0, dir: 0 }
};

// ---------------------------------------------------------------------------
// Clock. 12 real minutes per full day.
// ---------------------------------------------------------------------------
const CYCLE = 720;
// Half-width of the dawn/dusk band in "solar elevation" units. The elevation proxy
// e = -cos(2*pi*u/CYCLE) crosses zero at 2*pi/CYCLE per second, so a band of +/-0.393
// is ~90s of transition on each side.
const TWILIGHT = 0.393;

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Daylight from seconds-into-cycle. Midnight at u=0, noon at u=CYCLE/2.
function dayAt(u) {
  const e = -Math.cos((Math.PI * 2 * u) / CYCLE);
  const base = smoothstep(-TWILIGHT, TWILIGHT, e);
  // A gentle arc on top of the plateau so midday still reads as a curve rather than
  // a flat hold: exactly 1 at noon, easing off through the afternoon.
  return base * (0.85 + 0.15 * Math.max(0, e));
}

// --- THE SUN -----------------------------------------------------------------
// Elevation and azimuth are pure functions of the same solar proxy `e` the daylight
// curve rides, so the sun and the light it makes can never disagree.
//
// NOON IS THE ANCHOR. At u = CYCLE/2 the proxy is exactly +1 and the azimuth term is
// exactly 0, so elev = elevNoon (58) and azim = azimCenter (26.565): the shipped
// constants, reproduced bit-for-bit. Everything else is free to move.
//
// Below the horizon the elevation eases to a held floor rather than going negative —
// night is the moon/ambient regime and nothing down there wants a real sun vector.
// (Underwater consumers additionally clamp at Snell's 41.4 in config.js's setSun.)
function elevAt(e) {
  const s = GLASS.sun;
  return e >= 0 ? s.elevDawn + (s.elevNoon - s.elevDawn) * e
                : s.elevNight + (s.elevDawn - s.elevNight) * (1 + e);
}
// One sweep of `azimSweep` degrees across the whole cycle, centred on noon. It wraps
// at midnight — a discontinuity that is invisible because the sun is under the horizon
// and its elevation is pinned at the floor there.
function azimAt(u) {
  return GLASS.sun.azimCenter + GLASS.sun.azimSweep * (u / CYCLE - 0.5);
}
// Position on the palette ring. Rising half maps day 0..1 onto night->dawn->noon
// (0..2), falling half onto noon->dusk->night (2..4). day = 1 lands on 2 = the noon
// stop exactly, which is the palette half of the regression anchor.
function ringAt(day, rising) {
  const r = rising ? 2 * day : 4 - 2 * day;
  return r >= 4 ? 0 : r < 0 ? 0 : r;
}

// Sessions open mid-morning (day ~0.8 and rising) so the first thing a player sees is
// the luminous shallows. Solved once by scanning the rising half of the cycle.
const PHASE0 = (() => {
  let best = 0, bestErr = Infinity;
  for (let u = 0; u < CYCLE * 0.5; u += 0.25) {
    const err = Math.abs(dayAt(u) - 0.8);
    if (err < bestErr) { bestErr = err; best = u; }
  }
  return best;
})();

// ---------------------------------------------------------------------------
// THE DAY HAND.
//
// Every day index deals one hand from a mulberry32 stream seeded ONLY from that
// index, so day 4 is day 4 forever — across reloads, scrubs and jumps. The hand is
// dealt once per day-index CHANGE into a reused object; a frame that stays inside a
// day does no work at all.
//
// The storm now lives IN the hand rather than in a global schedule: most days deal
// no storm at all (the pop-up squall is an event, not a metronome), and on the days
// that do, the storm fires at the dealt hour and drives the SAME `st.storm` number
// the old scheduler drove, so env {sky,sea,below} keeps its lead/lag behaviour and
// every consumer downstream is untouched.
// ---------------------------------------------------------------------------
const RISE = 20, RELEASE = 30;

// The hand's storm is CONTAINED IN ITS DAY by construction: stormAt is dealt in
// [0.28, 0.72] and the hold caps at 120s, so a + RISE + hold + RELEASE < CYCLE. That
// is what lets one cached hand answer for the whole day with no neighbour lookups.
const STORM_AT_LO = 0.28, STORM_AT_HI = 0.72;
const STORM_ODDS = 1 / 3;            // most days are calm
const DUSK_PHASE = 0.75;             // where the daylight curve falls through zero
const PRE_DUSK = 2 / 24;             // "within ~2 hours-of-day before dusk"

let sSeed = 0x9e3779b1;
function rnd() {                     // mulberry32
  sSeed |= 0; sSeed = (sSeed + 0x6d2b79f5) | 0;
  let x = Math.imul(sSeed ^ (sSeed >>> 15), 1 | sSeed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
const rng = (a, b) => a + rnd() * (b - a);
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

// THE HAND — one reused object. `st.hand` points at this forever; consumers (sky,
// water, lab) read fields off it and must never hold a copy.
const hand = {
  dayIndex: -1,
  fog: 0, fogBurn: 20,
  clouds: 0, cloudTex: 0,
  stormDay: false, stormAt: 0, stormLen: 0, stormPeak: 0,
  sunsetDrama: 0,
  moonK: 0, moonPhase: 0,
  windBase: 0.2, windDir0: 0, windLead: 75
};

// Lightning strokes for THIS day's storm, flat + sorted, rewritten in place on each
// deal. 120s of hold at 8-25s spacing x (1 + up to 3 echoes) never reaches 128.
const FL_CAP = 128;
const flT = new Float32Array(FL_CAP), flA = new Float32Array(FL_CAP);
let flCount = 0;

// Absolute clock (in `tt` units) at which day `i` begins. PHASE0 shifts the session
// into mid-morning, so the day boundary sits at tt = i*CYCLE - PHASE0.
const dayStartT = i => i * CYCLE - PHASE0;
const dayIndexAt = tt => Math.floor((PHASE0 + tt) / CYCLE);

function dealHand(idx) {
  if (hand.dayIndex === idx) return;
  hand.dayIndex = idx;
  // Seed from the day index ALONE. The odd constant spreads adjacent indices across
  // the state space so day 3 and day 4 are unrelated rather than neighbours.
  sSeed = (Math.imul(idx | 0, 0x9e3779b1) ^ 0x5bf03635) | 0;
  for (let i = 0; i < 4; i++) rnd();   // warm-up: shake off the low-entropy first draw

  // --- marine layer ---
  // ~60% of days barely fog at all, ~34% a real layer, ~6% pea soup. That puts
  // fog > 0.3 on ~40% of days, which is the west-coast summer feel.
  const fr = rnd();
  hand.fog = fr < 0.60 ? rng(0.02, 0.30) : fr < 0.94 ? rng(0.30, 0.72) : rng(0.82, 0.95);
  // Solar elevation (deg) at which the layer has fully burned off. Thicker layers
  // hang on to a higher sun; a thin haze is gone by mid-morning.
  hand.fogBurn = Math.min(42, Math.max(8, 12 + 28 * hand.fog + rng(-3, 3)));

  // --- cloud regime ---
  const cr = rnd();
  hand.clouds = cr < 0.40 ? rng(0.00, 0.20)      // clear
              : cr < 0.78 ? rng(0.20, 0.55)      // fair cumulus
                          : rng(0.55, 0.95);     // building

  // --- storm dice ---
  hand.stormDay = rnd() < STORM_ODDS;
  hand.stormAt = rng(STORM_AT_LO, STORM_AT_HI);
  hand.stormLen = rng(60, 120);
  hand.stormPeak = rng(0.75, 0.92);
  // A squall day is never a clear day.
  if (hand.stormDay && hand.clouds < 0.55) hand.clouds = rng(0.55, 0.95);
  hand.cloudTex = clamp01(0.22 + 0.62 * hand.clouds + rng(-0.18, 0.18));

  // --- the sunset ---
  // Post-storm clearing feeds the sunset: if the squall lets go within ~2 hours of
  // day before dusk, the drama is biased hard up. That is the west-coast beat.
  const endPhase = hand.stormAt + (RISE + hand.stormLen + RELEASE) / CYCLE;
  const cleared = hand.stormDay && endPhase < DUSK_PHASE && endPhase > DUSK_PHASE - PRE_DUSK;
  const drama = rng(0.10, 0.75);
  hand.sunsetDrama = clamp01(cleared ? 0.62 + 0.38 * drama
                                     : drama * (0.55 + 0.55 * hand.clouds));

  // --- the moon ---
  // Phase WALKS ~0.12 per day so the cycle reads across a run of days; it is still a
  // pure function of the index, not an accumulator.
  hand.moonPhase = ((idx * 0.12 + 0.31) % 1 + 1) % 1;
  const illum = 1 - Math.abs(1 - 2 * hand.moonPhase);   // 0 = new, 1 = full
  hand.moonK = clamp01(0.12 + 0.88 * illum * rng(0.86, 1.06));

  // --- wind seeds ---
  hand.windBase = hand.clouds < 0.35 ? rng(0.10, 0.30) : rng(0.30, 0.50);
  hand.windDir0 = rng(0, Math.PI * 2);
  hand.windLead = rng(60, 90);        // seconds of rise BEFORE the squall lands

  dealLightning(idx);
}

function dealLightning(idx) {
  flCount = 0;
  if (!hand.stormDay) return;
  const a = dayStartT(idx) + hand.stormAt * CYCLE;
  const b = a + RISE + hand.stormLen;
  // Lightning lives in the hold: every 8-25s, a main stroke plus 1-3 echoes decaying
  // over ~0.8s.
  let f = a + RISE + rng(2, 10);
  while (f < b - 1.5 && flCount < FL_CAP - 4) {
    const amp = rng(0.6, 1.0);
    flT[flCount] = f; flA[flCount] = amp; flCount++;
    const echoes = 1 + Math.floor(rnd() * 3);
    let e = f;
    for (let k = 0; k < echoes; k++) {
      e += rng(0.09, 0.26);
      if (e - f > 0.85) break;
      flT[flCount] = e; flA[flCount] = amp * rng(0.22, 0.5); flCount++;
    }
    f += rng(8, 25);
  }
}

// A dev-forced storm (window.weather.storm()) gets its own stroke train, or the lab
// would test a squall with no lightning in it on a calm day. It overwrites the day's
// strokes until the next day-index change re-deals them; the forced storm retires
// itself well before that matters.
function forcedLightning(t0) {
  sSeed = (Math.imul(Math.floor(t0) | 0, 0x85ebca6b) ^ 0x27d4eb2f) | 0;
  flCount = 0;
  const b = t0 + RISE + 90;
  let f = t0 + RISE + rng(2, 8);
  while (f < b - 1.5 && flCount < FL_CAP - 4) {
    const amp = rng(0.6, 1.0);
    flT[flCount] = f; flA[flCount] = amp; flCount++;
    let e = f;
    const echoes = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < echoes; k++) {
      e += rng(0.09, 0.26);
      if (e - f > 0.85) break;
      flT[flCount] = e; flA[flCount] = amp * rng(0.22, 0.5); flCount++;
    }
    f += rng(8, 25);
  }
}

// The day's storm window in absolute clock units. Written into a reused object.
const win = { a: 0, b: 0, c: 0, peak: 0, live: false };
function stormWindow(idx) {
  win.live = hand.stormDay;
  const a = dayStartT(idx) + hand.stormAt * CYCLE;
  win.a = a; win.b = a + RISE + hand.stormLen; win.c = win.b + RELEASE;
  win.peak = hand.stormPeak;
  return win;
}

// The same envelope shape the old scheduler produced, now fed by the hand.
function stormEnv(tt, idx) {
  const w = stormWindow(idx);
  if (!w.live || tt < w.a || tt >= w.c) return 0;
  let env;
  if (tt < w.a + RISE) env = smoothstep(0, 1, (tt - w.a) / RISE) * w.peak;
  else if (tt < w.b) {
    // Slow +/-0.15 wander across the hold, two incommensurate rates so it never
    // reads as a loop.
    const k = tt - w.a;
    env = w.peak + 0.09 * Math.sin(k * 0.081 + idx) + 0.06 * Math.sin(k * 0.213 + idx * 2.3);
  } else env = (1 - smoothstep(0, 1, (tt - w.b) / (w.c - w.b))) * w.peak;
  return env < 0 ? 0 : env > 1 ? 1 : env;
}

const FLASH_DECAY = 0.045;           // ~2 frames at 60fps
function flashAt(tt) {
  let v = 0;
  for (let i = 0; i < flCount; i++) {
    const d = tt - flT[i];
    if (d < 0 || d > FLASH_DECAY) continue;
    const a = flA[i] * (1 - d / FLASH_DECAY);
    if (a > v) v = a;
  }
  return v;
}

// ---------------------------------------------------------------------------
// WIND. Pure function of the clock + the day's hand; nothing is integrated, so a
// scrub lands on exactly the wind that time-of-day owns.
//   speed  0..1   base (per day) x diurnal lull, lifted by the storm approach, plus
//                 a smooth gust term (sum of three incommensurate sines — never a
//                 per-frame random).
//   dir    rad    slow drift over hours; LOCKED for a storm's whole duration, because
//                 a squall brings its own wind and holds it until it lets go.
// ---------------------------------------------------------------------------
const GUST_FALL = 90;                // seconds the wind takes to let go after a storm

function gustAt(tt) {
  return 0.062 * Math.sin(tt * 0.3701)
       + 0.045 * Math.sin(tt * 0.8313 + 1.7)
       + 0.028 * Math.sin(tt * 1.5227 + 4.1);
}

// The storm's own wind envelope: begins rising windLead seconds BEFORE the squall,
// peaks with it, falls over its release plus GUST_FALL.
function stormWindAt(tt, idx) {
  const w = stormWindow(idx);
  if (!w.live) return 0;
  const lead = hand.windLead;
  if (tt < w.a - lead || tt > w.c + GUST_FALL) return 0;
  if (tt < w.a + RISE) return smoothstep(0, 1, (tt - (w.a - lead)) / (lead + RISE));
  if (tt < w.b) return 1;
  return 1 - smoothstep(0, 1, (tt - w.b) / (w.c - w.b + GUST_FALL));
}

function dirAt(tt) {
  // Two slow incommensurate terms: a full lazy veer over ~4 days plus an hour-scale
  // wobble. About +/-0.5 rad of drift, which is a weather system moving, not a spin.
  return hand.windDir0
       + 0.42 * Math.sin(tt * (Math.PI * 2) / (4 * CYCLE))
       + 0.16 * Math.sin(tt / 431.7 + 2.1);
}

function updateWind(tt, idx, dayFac) {
  // Overnight lull: the sea breeze dies with the sun.
  const diurnal = 0.58 + 0.42 * dayFac;
  const sw = stormWindAt(tt, idx);
  let s = hand.windBase * diurnal;
  s += (0.97 - s) * sw;                       // the squall dominates when it owns the sky
  s += gustAt(tt) * (0.35 + 0.65 * s);
  st.wind.speed = clamp01(s);
  // A storm LOCKS the direction for its duration (frozen at the moment it landed).
  const w = win;                              // stormWindAt() just refreshed it
  st.wind.dir = (w.live && tt >= w.a && tt <= w.c) ? dirAt(w.a) : dirAt(tt);
}

// ---------------------------------------------------------------------------
// Surface layer: rain drumming on the underside of the water, storm churn,
// lightning sheet, and a cool moon dapple at night. Its own thin plane just under
// the surface so water.js stays untouched. Lives in the top ~120 units only.
// ---------------------------------------------------------------------------
const PLANE_Y = SURFACE_Y - 0.5;
const REACH = 200;                   // world radius the layer covers around the diver
let rainMesh = null, ru = null;

function buildRainLayer() {
  const g = new THREE.PlaneGeometry(REACH * 2, REACH * 2, 1, 1);
  g.rotateX(-Math.PI / 2);
  ru = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uStorm: { value: 0 },
    uFlash: { value: 0 },
    uNight: { value: 0 },
    uFade: { value: 0 }
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: ru,
    transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    // ONE draw call, not two. Since r163 three renders a transparent DoubleSide material
    // in two passes (back faces, then front) unless this is set. This plane is only
    // ever seen from below and shades identically on both faces, so the second pass
    // buys nothing but a submission.
    forceSinglePass: true,
    vertexShader: `
      uniform vec3 uCam;
      varying vec2 vQ; varying float vR;
      void main(){
        vec3 p = position;
        p.x += uCam.x; p.z += uCam.z;        // the layer rides with the diver
        p.y = ${PLANE_Y.toFixed(3)};
        vQ = p.xz;
        vR = distance( p.xz, uCam.xz ) / ${REACH.toFixed(1)};
        gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
      }`,
    fragmentShader: `
      uniform float uTime, uStorm, uFlash, uNight, uFade;
      varying vec2 vQ; varying float vR;

      float h21( vec2 p ){
        p = fract( p * vec2( 123.34, 456.21 ) );
        p += dot( p, p + 45.32 );
        return fract( p.x * p.y );
      }
      float vnoise( vec2 p ){
        vec2 i = floor( p ), f = fract( p );
        f = f * f * ( 3.0 - 2.0 * f );
        float a = h21( i ), b = h21( i + vec2(1.0,0.0) );
        float c = h21( i + vec2(0.0,1.0) ), d = h21( i + vec2(1.0,1.0) );
        return mix( mix(a,b,f.x), mix(c,d,f.x), f.y );
      }

      // One expanding ring per cell per beat: rain striking the underside.
      // De-latticed the same three ways as water.js's splash() (which see): jittered
      // centres, dead cells, and a PER-CELL beat — rate and phase both vary per cell,
      // so neighbours never fire together and the density never reads as periodic.
      // Amplitude varies per cell too, and jitter + max radius + ring width stays
      // inside the cell so no ring is ever clipped into a straight (lattice) edge.
      // Cost-identical to the old form: one h21, three fracts, one length per call.
      float rainCells( vec2 p, float rate, float seed ){
        vec2 i = floor( p );
        float r = h21( i + seed );
        float j1 = fract( r * 97.13 ), j2 = fract( r * 41.71 ), j3 = fract( r * 173.71 );
        float amp = step( 0.30, j3 ) * ( 0.55 + 0.75 * j3 );
        vec2 f = fract( p ) - ( 0.5 + vec2( j1, j2 ) * 0.36 - 0.18 );
        float ph = fract( uTime * rate * ( 0.62 + 0.55 * j2 ) + r );
        float rad = ph * ( 0.18 + 0.08 * j1 );
        float d = length( f );
        float ring = smoothstep( 0.030, 0.0, abs( d - rad ) );
        float speck = smoothstep( 0.045, 0.0, d ) * ( 1.0 - ph );
        return ( ring * ( 1.0 - ph ) + speck * 0.9 ) * amp;
      }

      void main(){
        float edge = 1.0 - smoothstep( 0.45, 1.0, vR );
        float k = uFade * edge;
        // Additive blend: writing pure black is bit-identical to discarding the
        // fragment, and NOT using discard keeps early-z on for the whole plane.
        if ( k <= 0.001 ) { gl_FragColor = vec4( 0.0 ); return; }

        vec3 col = vec3( 0.0 );

        if ( uStorm > 0.001 ) {
          // Rain: two cell scales so it never reads as a single grid.
          float rain = rainCells( vQ * 0.42, 1.10, 0.0 ) * 0.9
                     + rainCells( vQ * 0.95, 1.65, 11.0 ) * 0.55;
          col += vec3( 0.70, 0.82, 0.92 ) * rain * uStorm * 1.15;

          // Churn: two scrolling noise sheets, the underside going busy.
          float ch = vnoise( vQ * 0.06 + vec2( uTime * 0.16, -uTime * 0.11 ) )
                   * vnoise( vQ * 0.15 - vec2( uTime * 0.23, uTime * 0.19 ) );
          ch = smoothstep( 0.12, 0.65, ch );
          col += vec3( 0.34, 0.46, 0.55 ) * ch * uStorm * uStorm * 0.36;
        }

        // Moon dapple: cooler and far dimmer than the sun's caustics, night only.
        if ( uNight > 0.001 ) {
          float m = sin( vQ.x * 0.19 + uTime * 0.35 ) * sin( vQ.y * 0.163 - uTime * 0.28 )
                  + 0.6 * sin( ( vQ.x + vQ.y ) * 0.101 + uTime * 0.21 );
          m = smoothstep( 0.55, 1.35, m + 0.6 );
          col += vec3( 0.42, 0.54, 0.78 ) * m * uNight * 0.16;
        }

        // Lightning: a broad silver sheet across the whole ceiling.
        col += vec3( 0.72, 0.80, 0.92 ) * uFlash * ( 0.30 + 0.35 * ( 1.0 - vR ) );

        gl_FragColor = vec4( col * k, 1.0 );
      }`
  });
  rainMesh = new THREE.Mesh(g, mat);
  rainMesh.frustumCulled = false;
  rainMesh.renderOrder = 3;
  rainMesh.visible = false;
  rainMesh.onBeforeRender = (r, s, cam) => ru.uCam.value.copy(cam.position);
  scene.add(rainMesh);
}

// ---------------------------------------------------------------------------
let tOff = 0;                        // dev scrub offset
// Lab clock controls. The weather clock stays `t + tOff` — pause and speed are
// implemented by STEERING tOff against the raw frame delta rather than by keeping a
// second clock, so scrub/advance and determinism are unaffected: at any instant the
// whole system is still a pure function of one number.
let rawPrev = -1, wSpeed = 1, wPaused = false;
let fDay = -1, fStorm = -1;          // dev overrides (<0 = off)
let forcedT0 = -1;                   // dev-triggered storm start
let fFlash = -1, fFlashT = 0;        // dev-injected stroke (<0 = off) and its hold
let pendDay = -1e9;               // day() target before the next frame confirms it
let envSeed = true;                  // seed the envelope on frame 1, don't ramp from 0

export function initWeather() {
  st.hand = hand;
  dealHand(dayIndexAt(0));
  buildRainLayer();

  // Dev helpers: window.weather.set(day, storm) / .storm() / .advance(sec).
  // Kept so this and future sessions can force a state for screenshots.
  if (typeof window !== 'undefined') {
    window.weather = {
      set(day, storm) {
        fDay = (day === null || day === undefined) ? -1 : Math.min(1, Math.max(0, day));
        fStorm = (storm === null || storm === undefined) ? -1 : Math.min(1, Math.max(0, storm));
      },
      storm() { forcedT0 = lastT; fStorm = -1; forcedLightning(lastT); },
      advance(sec) { tOff += sec; },
      // Fire a stroke on the next frame — for grabbing a flash frame on demand.
      // Fire a stroke and hold it for `hold` seconds — a real stroke is 2 frames,
      // which is impossible to screenshot.
      flash(a, hold) { fFlash = a === undefined ? 0.95 : a; fFlashT = hold === undefined ? 0 : hold; },
      // --- lab controls ---
      // Jump to a fraction of the full day cycle (0 = midnight, 0.5 = noon).
      scrub(u01) {
        const want = ((u01 % 1) + 1) % 1 * CYCLE;
        const have = (PHASE0 + lastT) % CYCLE;
        tOff += want - have;
      },
      // Jump the DAY INDEX (scrub only moves inside the current day). Keeps the
      // time-of-day where it is, so the lab can compare the same hour across hands.
      day(n) {
        const cur = pendDay >= -1e8 ? pendDay : dayIndexAt(lastT);
        if (n === undefined) return cur;
        const w = Math.floor(n);
        tOff += (w - cur) * CYCLE;
        pendDay = w;                  // so two day() calls before a frame still land right
        return w;
      },
      // Deal any day's hand WITHOUT moving the clock — the lab's reroll/preview and
      // the way a probe reads a run of days. Restores the live day's hand after.
      peek(n) {
        const cur = hand.dayIndex;
        dealHand(Math.floor(n));
        const snap = window.weather.hand();
        dealHand(cur);
        return snap;
      },
      pause(b) { wPaused = b === undefined ? true : !!b; },
      speed(k) { wSpeed = k === undefined ? 1 : Math.max(0, k); },
      wind() { return { speed: st.wind.speed, dir: st.wind.dir }; },
      hand() {
        const h = st.hand;
        return {
          dayIndex: h.dayIndex, fog: h.fog, fogBurn: h.fogBurn,
          clouds: h.clouds, cloudTex: h.cloudTex,
          stormDay: h.stormDay, stormAt: h.stormAt, stormLen: h.stormLen,
          stormPeak: h.stormPeak, sunsetDrama: h.sunsetDrama,
          moonK: h.moonK, moonPhase: h.moonPhase,
          windBase: h.windBase, windDir0: h.windDir0, windLead: h.windLead
        };
      },
      state() {
        return {
          day: st.day, storm: st.storm, flash: st.flash, clock: lastT,
          sunElev: st.sunElev, sunAzim: st.sunAzim, phase01: st.phase01, ring: st.ring,
          dayIndex: st.dayIndex,
          env: { sky: st.env.sky, sea: st.env.sea, below: st.env.below },
          hand: window.weather.hand(),
          wind: { speed: st.wind.speed, dir: st.wind.dir }
        };
      }
    };
  }
}

let lastT = 0;

export function updateWeather(dt, t) {
  // Steer the scrub offset so the weather clock runs at wSpeed (0 while paused).
  if (rawPrev < 0) rawPrev = t;
  const dRaw = t - rawPrev;
  rawPrev = t;
  if (wPaused) tOff -= dRaw;
  else if (wSpeed !== 1) tOff += dRaw * (wSpeed - 1);

  const tt = t + tOff;
  lastT = tt;

  const u = ((PHASE0 + tt) % CYCLE + CYCLE) % CYCLE;
  // THE DAY HAND. dealHand() early-outs on an unchanged index, so this is one floor
  // and one compare on every frame but the first of a day (and after a scrub/jump).
  const dIdx = dayIndexAt(tt);
  pendDay = -1e9;
  st.dayIndex = dIdx;
  dealHand(dIdx);

  st.day = fDay >= 0 ? fDay : dayAt(u);

  if (fStorm >= 0) {
    st.storm = fStorm;
  } else if (forcedT0 >= 0) {
    // A dev-forced storm: same envelope shape, 90s hold, then it retires itself.
    const k = tt - forcedT0;
    // On retire, force a re-deal so the day gets its own stroke train back.
    if (k > RISE + 90 + RELEASE) { forcedT0 = -1; st.storm = 0; hand.dayIndex = -1; }
    else if (k < RISE) st.storm = smoothstep(0, 1, k / RISE);
    else if (k < RISE + 90) st.storm = 0.92 + 0.08 * Math.sin(k * 0.13);
    else st.storm = 1 - smoothstep(0, 1, (k - RISE - 90) / RELEASE);
  } else {
    // The hand's storm — and ONLY the hand's. On a calm day this is flatly 0: the
    // old "a squall every 5-9 minutes forever" schedule is gone on purpose.
    st.storm = stormEnv(tt, dIdx);
  }

  // Lightning only during a storm's hold plateau, and it scales with intensity.
  if (fFlash >= 0) { st.flash = fFlash; fFlashT -= dt; if (fFlashT <= 0) fFlash = -1; }
  else st.flash = st.storm > 0.55 ? flashAt(tt) * st.storm : 0;

  // --- the sun ---------------------------------------------------------------
  // Under a forced day (window.weather.set) the proxy is recovered from the forced
  // value so a screenshot at "day 1" really is noon, sun and all.
  const eRaw = -Math.cos((Math.PI * 2 * u) / CYCLE);
  const rising = u < CYCLE * 0.5;
  const e = fDay >= 0 ? 2 * fDay - 1 : eRaw;
  st.sunElev = elevAt(e > 1 ? 1 : e < -1 ? -1 : e);
  // Forced day: place the sun on whichever half of the sky the live clock is on, so a
  // forced day = 1 still gives azimCenter exactly and forced twilight still has a side.
  st.sunAzim = fDay >= 0
    ? GLASS.sun.azimCenter + GLASS.sun.azimSweep * 0.5 * (1 - st.day) * (rising ? -1 : 1)
    : azimAt(u);
  st.phase01 = u / CYCLE;
  st.ring = ringAt(st.day, rising);
  setSun(st.sunElev, st.sunAzim);
  setSkyPhase(st.phase01, st.ring);

  // --- the one envelope ------------------------------------------------------
  // First-order lags off the same storm number. Sky is effectively immediate, the sea
  // trails it, the column below lags ~8s: weather arrives from ABOVE. Because they are
  // lags and not separate curves, a held storm drives all three to the same value —
  // that convergence is the storm-parity probe.
  const dtw = dt * (wPaused ? 0 : wSpeed);
  if (envSeed) { st.env.sky = st.env.sea = st.env.below = st.storm; envSeed = false; }
  else {
    st.env.sky += (st.storm - st.env.sky) * (1 - Math.exp(-dtw / 1.2));
    st.env.sea += (st.storm - st.env.sea) * (1 - Math.exp(-dtw / 3.5));
    st.env.below += (st.storm - st.env.below) * (1 - Math.exp(-dtw / 8.0));
  }

  // --- wind ------------------------------------------------------------------
  // After the envelope so it reads the same clock, but it is not derived from env:
  // wind LEADS the storm, env lags it.
  updateWind(tt, dIdx, st.day);

  // --- surface layer -------------------------------------------------------
  const camY = camera.position.y;
  const night = st.day < 0.25 ? (1 - st.day / 0.25) : 0;
  // Retire the layer over the first 120 units: the abyss never sees weather.
  const depthFade = camY > -120 ? 1 - smoothstep(60, 120, -camY) : 0;
  const show = depthFade > 0.004 && (st.storm > 0.05 || night > 0.02);
  rainMesh.visible = show;
  if (show) {
    ru.uTime.value = tt;
    ru.uStorm.value = st.storm > 0.05 ? st.storm : 0;
    ru.uFlash.value = st.flash;
    ru.uNight.value = night * (1 - 0.7 * st.storm);
    ru.uFade.value = depthFade;
  }

  return st;
}
