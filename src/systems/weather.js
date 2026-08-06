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
//     }
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
const st = {
  day: 1, storm: 0, flash: 0,
  sunElev: GLASS.sun.elevNoon, sunAzim: GLASS.sun.azimCenter,
  phase01: 0.5, ring: 2,
  env: { sky: 0, sea: 0, below: 0 }
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
// Storm schedule. Deterministic PRNG from a fixed seed, precomputed once.
// ---------------------------------------------------------------------------
const RISE = 20, RELEASE = 30;
const HORIZON = 12 * 3600;          // 12h of weather; a session will never outrun it.

let sSeed = 0x9e3779b1;
function rnd() {                     // mulberry32
  sSeed |= 0; sSeed = (sSeed + 0x6d2b79f5) | 0;
  let x = Math.imul(sSeed ^ (sSeed >>> 15), 1 | sSeed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
const rng = (a, b) => a + rnd() * (b - a);

// Storms, flat arrays (index i): start of rise, start of release, end.
let stT0 = null, stT1 = null, stT2 = null, stPeak = null, stCount = 0;
// Lightning sub-impulses, flat and sorted: fire time + amplitude.
let flT = null, flA = null, flCount = 0;

function buildSchedule() {
  const t0 = [], t1 = [], t2 = [], pk = [];
  const ft = [], fa = [];
  // First storm never before 3 minutes.
  let cursor = 180 + rng(0, 90);
  while (cursor < HORIZON) {
    const hold = rng(60, 120);
    const a = cursor, b = a + RISE + hold, c = b + RELEASE;
    t0.push(a); t1.push(b); t2.push(c); pk.push(rng(0.75, 0.92));
    // Lightning lives in the hold: every 8-25s, a main stroke plus 1-3 echoes
    // decaying over ~0.8s.
    let f = a + RISE + rng(2, 10);
    while (f < b - 1.5) {
      const amp = rng(0.6, 1.0);
      ft.push(f); fa.push(amp);
      const echoes = 1 + Math.floor(rnd() * 3);
      let e = f;
      for (let k = 0; k < echoes; k++) {
        e += rng(0.09, 0.26);
        if (e - f > 0.85) break;
        ft.push(e); fa.push(amp * rng(0.22, 0.5));
      }
      f += rng(8, 25);
    }
    cursor = c + rng(300 - RISE - hold - RELEASE, 540 - RISE - hold - RELEASE);
    // Gaps are measured storm-start to storm-start (5-9 min); guard the degenerate case.
    if (cursor < c + 20) cursor = c + 20;
  }
  stT0 = Float32Array.from(t0); stT1 = Float32Array.from(t1);
  stT2 = Float32Array.from(t2); stPeak = Float32Array.from(pk);
  stCount = t0.length;
  flT = Float32Array.from(ft); flA = Float32Array.from(fa);
  flCount = ft.length;
}

// Monotonic cursors, re-seeked only when the clock jumps backwards (dev scrubbing).
let sIdx = 0, fIdx = 0;

function seek(arr, n, tt, idx) {
  if (idx >= n || arr[idx] > tt) idx = 0;
  while (idx + 1 < n && arr[idx + 1] <= tt) idx++;
  return idx;
}

function stormAt(tt) {
  sIdx = seek(stT2, stCount, tt, sIdx);
  // seek() lands on the last storm whose END has passed; the live one is the next.
  let i = sIdx;
  if (i < stCount && stT2[i] <= tt) i++;
  if (i >= stCount) return 0;
  const a = stT0[i];
  if (tt < a) return 0;
  const b = stT1[i], c = stT2[i], peak = stPeak[i];
  let env;
  if (tt < a + RISE) env = smoothstep(0, 1, (tt - a) / RISE) * peak;
  else if (tt < b) {
    // Slow +/-0.15 wander across the hold, two incommensurate rates so it never
    // reads as a loop.
    const k = tt - a;
    env = peak + 0.09 * Math.sin(k * 0.081 + i) + 0.06 * Math.sin(k * 0.213 + i * 2.3);
  } else env = (1 - smoothstep(0, 1, (tt - b) / (c - b))) * peak;
  return env < 0 ? 0 : env > 1 ? 1 : env;
}

const FLASH_DECAY = 0.045;           // ~2 frames at 60fps
function flashAt(tt) {
  if (!flCount) return 0;
  fIdx = seek(flT, flCount, tt, fIdx);
  let v = 0;
  for (let i = fIdx > 0 ? fIdx - 1 : 0; i <= fIdx; i++) {
    const d = tt - flT[i];
    if (d < 0 || d > FLASH_DECAY) continue;
    const a = flA[i] * (1 - d / FLASH_DECAY);
    if (a > v) v = a;
  }
  return v;
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
      float rainCells( vec2 p, float rate, float seed ){
        vec2 i = floor( p ), f = fract( p ) - 0.5;
        float r = h21( i + seed );
        float ph = fract( uTime * rate + r );
        float rad = ph * 0.46;
        float d = length( f - ( vec2( h21(i+7.1+seed), h21(i+3.7+seed) ) - 0.5 ) * 0.5 );
        float ring = smoothstep( 0.030, 0.0, abs( d - rad ) );
        float speck = smoothstep( 0.045, 0.0, d ) * ( 1.0 - ph );
        return ( ring * ( 1.0 - ph ) + speck * 0.9 ) * step( 0.30, r );
      }

      void main(){
        float edge = 1.0 - smoothstep( 0.45, 1.0, vR );
        float k = uFade * edge;
        if ( k <= 0.001 ) discard;

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
let envSeed = true;                  // seed the envelope on frame 1, don't ramp from 0

export function initWeather() {
  buildSchedule();
  buildRainLayer();

  // Dev helpers: window.weather.set(day, storm) / .storm() / .advance(sec).
  // Kept so this and future sessions can force a state for screenshots.
  if (typeof window !== 'undefined') {
    window.weather = {
      set(day, storm) {
        fDay = (day === null || day === undefined) ? -1 : Math.min(1, Math.max(0, day));
        fStorm = (storm === null || storm === undefined) ? -1 : Math.min(1, Math.max(0, storm));
      },
      storm() { forcedT0 = lastT; fStorm = -1; },
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
      pause(b) { wPaused = b === undefined ? true : !!b; },
      speed(k) { wSpeed = k === undefined ? 1 : Math.max(0, k); },
      state() {
        return {
          day: st.day, storm: st.storm, flash: st.flash, clock: lastT,
          sunElev: st.sunElev, sunAzim: st.sunAzim, phase01: st.phase01, ring: st.ring,
          env: { sky: st.env.sky, sea: st.env.sea, below: st.env.below }
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
  st.day = fDay >= 0 ? fDay : dayAt(u);

  if (fStorm >= 0) {
    st.storm = fStorm;
  } else if (forcedT0 >= 0) {
    // A dev-forced storm: same envelope shape, 90s hold, then it retires itself.
    const k = tt - forcedT0;
    if (k > RISE + 90 + RELEASE) { forcedT0 = -1; st.storm = 0; }
    else if (k < RISE) st.storm = smoothstep(0, 1, k / RISE);
    else if (k < RISE + 90) st.storm = 0.92 + 0.08 * Math.sin(k * 0.13);
    else st.storm = 1 - smoothstep(0, 1, (k - RISE - 90) / RELEASE);
  } else {
    st.storm = stormAt(tt);
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
