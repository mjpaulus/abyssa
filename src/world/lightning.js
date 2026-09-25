// LIGHTNING AS A LIGHT. OWNED BY: lightning agent (roadmap/ref-lightning-light.md).
//
// Before this, a strike was a scalar (weather.js `flash`) that lifted the sun and the
// hemisphere for two frames and drew a silver sheet on the underside of the sea. Now
// each MAIN stroke of the weather's deterministic schedule (weather.js dealLightning /
// forcedLightning: the first stroke of every group; the echoes after it are the return
// strokes) grows a real channel and becomes a light in the scene:
//
//   THE BOLT     a recursive midpoint-displaced polyline from the cloud base (just under
//                GLASS.puff.deckY) down TOWARD the sea -- never to it: the channel ends
//                4-14 units up, the way a strike over open water reads from a boat --
//                with 2-4 branches leaving the trunk in its upper half. All bolts are
//                ONE InstancedBufferGeometry of thin camera-facing quads (a view-space
//                ribbon per segment), additive, fog:false like the vent embers (this is
//                AIR, and the patched Beer-Lambert chunk would turn it teal in metres).
//                One draw call for every live bolt; a pool of POOL channels; a pooled
//                typed-array scratch for the growth. ZERO per-frame allocation.
//   THE PULSES   core brightness is the sum of the group's strokes (main + echoes, the
//                weather's own timings and amplitudes), each an instant rise and a
//                ~35 ms decay, so a channel re-brightens 2-4 times over 100-850 ms;
//                after the last pulse a fainter, wider AFTERIMAGE lingers ~250 ms.
//   THE LIGHT    the two strongest live bolts are written into the fog chunk's two
//                uniform slots (water.js setBoltLight): every fogged material in the
//                game -- sea, raft, terrain, Sal, plankton -- is lit from the bolt's own
//                side, inverse-square with a floor, extinguished on its water leg.
//                Not a THREE light: the scene's light count is sacred (adding one
//                recompiles every lit material mid-game).
//   DETERMINISM  a bolt's position and shape are a pure function of (deal seed, stroke
//                index): the same storm hand strikes in the same places on every load.
//                Not one rnd() draw is added to the weather's stream.
//
// Contract with game.js:
//   buildLightning()          once, after buildWater (imports its bolt-uniform writers).
//   updateLightning(dt, wx, rm) every frame after updateWeather; wx is its returned state,
//                             rm = reducedMotion() (quarter intensity, like gateFlash).
//   window.__bolt             { state(), fire(x, z, strength), last() } dev probe; last()
//                             is for audio: {x, y, z, t, amp} of the most recent strike so
//                             the thunder can be placed and delayed by range.
import * as THREE from 'three';
import { scene, camera } from '../core.js';
import { GLASS, SURFACE_Y } from '../config.js';
import { refrHide, setBoltLight, setBoltParams } from './water.js';
import { lightningSchedule } from '../systems/weather.js';

const POOL = 4;                          // concurrent channels
const SEG_MAIN = 64;                     // trunk segments (depth-6 midpoint displacement)
const BR_MAX = 4, SEG_BR = 16;           // branches per bolt, segments each (depth 4)
const SEG_PER = SEG_MAIN + BR_MAX * SEG_BR;   // 128 quads per channel
const N = POOL * SEG_PER;                // 512 quads in the pool
const PULSE_TAU = 0.035;                 // return-stroke decay (s)
const PULSE_HOLD = 0.025;                // peak hold before the decay (one frame)
const AFTER_TAU = 0.25;                  // afterimage decay (s)
const LIFE_AFTER = 0.9;                  // seconds past the last pulse before the slot frees
const MAX_PULSES = 6;

// --- the pool ---------------------------------------------------------------------
// Per-slot state in flat typed arrays. `t0` is the main stroke's clock; pulses are
// offsets from it. Light anchor (lx, ly, lz) is the channel point 30% up from its foot:
// the return stroke is brightest low, and a light there rakes the deck, not the sky.
const bT0 = new Float64Array(POOL).fill(-1e9);
const bAmp = new Float32Array(POOL);
const bNP = new Uint8Array(POOL);
const bPT = new Float32Array(POOL * MAX_PULSES), bPA = new Float32Array(POOL * MAX_PULSES);
const bLX = new Float32Array(POOL), bLY = new Float32Array(POOL), bLZ = new Float32Array(POOL);
const bTX = new Float32Array(POOL), bTZ = new Float32Array(POOL);   // trunk top (for audio/probe)
const bLive = new Uint8Array(POOL);
const bCore = new Float32Array(POOL), bGlow = new Float32Array(POOL), bI = new Float32Array(POOL);

// Growth scratch: one polyline of SEG_MAIN + 1 points, reused for every trunk and branch.
const pts = new Float32Array((SEG_MAIN + 1) * 3);

// Per-bolt mulberry32 -- seeded from (deal seed, stroke index), never from the clock.
let rs = 1;
function rnd() {
  rs |= 0; rs = (rs + 0x6d2b79f5) | 0;
  let x = Math.imul(rs ^ (rs >>> 15), 1 | rs);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
const rng = (a, b) => a + rnd() * (b - a);
function seedFor(dealSeed, k) {
  rs = (Math.imul(dealSeed | 0, 0x9e3779b1) ^ Math.imul((k + 1) | 0, 0x85ebca6b) ^ 0x5bd1e995) | 0;
  rnd(); rnd();
}

// --- geometry ---------------------------------------------------------------------
let geo = null, mat = null, mesh = null;
let aP0 = null, aP1 = null, aK = null;
const uBolt = { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] };
const uCol = { value: new THREE.Vector3(0.8, 0.86, 1.0) };
const uWidthK = { value: 1 };

export function buildLightning() {
  const base = new THREE.PlaneGeometry(1, 1);
  geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  geo.attributes.uv = base.attributes.uv;
  aP0 = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);   // xyz + slot id
  aP1 = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);   // xyz + half-width
  aK = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2);    // brightness, spare
  aP0.setUsage(THREE.DynamicDrawUsage); aP1.setUsage(THREE.DynamicDrawUsage); aK.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aP0', aP0);
  geo.setAttribute('aP1', aP1);
  geo.setAttribute('aK', aK);
  geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  // Slot ids are fixed forever: quad q belongs to channel floor(q / SEG_PER).
  const p0 = aP0.array;
  for (let q = 0; q < N; q++) p0[q * 4 + 3] = (q / SEG_PER) | 0;

  mat = new THREE.ShaderMaterial({
    uniforms: { uBolt, uCol, uWidthK },
    transparent: true, depthWrite: false, depthTest: true, fog: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true,
    vertexShader: `
      attribute vec4 aP0, aP1;
      attribute vec2 aK;
      uniform vec4 uBolt[${POOL}];      // x = core, y = afterimage glow, per channel
      uniform float uWidthK;
      varying vec2 vUv;
      varying float vI, vG;
      void main(){
        vec4 b = uBolt[ int( aP0.w + 0.5 ) ];
        float core = b.x * aK.x, glow = b.y * aK.x;
        vUv = uv; vI = core; vG = glow;
        // A dead quad (width 0, or a channel that has gone out) leaves the clip volume:
        // cheaper than a discard per fragment and it never touches the depth buffer.
        if ( core + glow < 0.002 || aP1.w <= 0.0 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
        vec3 pm = mix( aP0.xyz, aP1.xyz, uv.y );
        vec3 dir = normalize( aP1.xyz - aP0.xyz );
        vec3 toCam = normalize( cameraPosition - pm );
        vec3 side = cross( dir, toCam );
        float sl = length( side );
        side = sl > 1e-4 ? side / sl : vec3( 1.0, 0.0, 0.0 );
        // The afterimage is wider and dimmer than the stroke: the channel's glow, not
        // its filament. Width follows the glow share, so it swells as the core dies.
        float w = aP1.w * uWidthK * ( 1.0 + 2.5 * glow / max( core + glow, 1e-3 ) );
        vec3 wp = pm + side * ( ( uv.x - 0.5 ) * 2.0 * w );
        gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
      }`,
    fragmentShader: `
      uniform vec3 uCol;
      varying vec2 vUv;
      varying float vI, vG;
      void main(){
        float x = abs( vUv.x - 0.5 ) * 2.0;
        float fil  = exp( -x * x * 14.0 );    // the hot filament
        float halo = exp( -x * x * 2.2 );     // its corona
        // The filament goes to white; the corona and the afterimage carry the colour.
        vec3 c = vec3( 1.0 ) * fil * vI * 2.5 + uCol * halo * ( vI * 0.6 + vG * 0.5 );
        gl_FragColor = vec4( c, 1.0 );
      }`
  });
  mat.customProgramCacheKey = () => 'abyssa-bolt-v1';
  mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 4;
  // Out of the refraction pass for the reason the rain is: from the air that pass keeps
  // the WATER half and a plain ShaderMaterial ignores the clip plane, so the channel
  // would show through the surface as if it struck under it.
  refrHide.push(mesh);
  scene.add(mesh);
  installProbe();
}

// --- growth -----------------------------------------------------------------------
// Recursive midpoint displacement over the scratch polyline: pts[lo] and pts[hi] are set,
// the midpoint takes their mean plus a random offset scaled by `amp`, and each level
// halves the amplitude (a 0.55 roughness would be a smoother leader; lightning is
// jagged at every scale). Numeric arguments only: nothing is allocated.
function subdiv(lo, hi, amp) {
  const mid = (lo + hi) >> 1;
  if (mid === lo) return;
  const i0 = lo * 3, i1 = hi * 3, im = mid * 3;
  pts[im]     = 0.5 * (pts[i0]     + pts[i1])     + rng(-amp, amp);
  pts[im + 1] = 0.5 * (pts[i0 + 1] + pts[i1 + 1]) + rng(-amp, amp) * 0.35;
  pts[im + 2] = 0.5 * (pts[i0 + 2] + pts[i1 + 2]) + rng(-amp, amp);
  subdiv(lo, mid, amp * 0.5);
  subdiv(mid, hi, amp * 0.5);
}

// Write the scratch polyline's `nseg` segments into the instance buffers at quad `q`
// with half-width `w` and brightness `k0` fading to `k1` along it. Returns the next q.
function emit(q, nseg, w, k0, k1) {
  const p0 = aP0.array, p1 = aP1.array, kk = aK.array;
  for (let i = 0; i < nseg; i++, q++) {
    const a = i * 3, b = a + 3, o = q * 4;
    p0[o] = pts[a]; p0[o + 1] = pts[a + 1]; p0[o + 2] = pts[a + 2];
    p1[o] = pts[b]; p1[o + 1] = pts[b + 1]; p1[o + 2] = pts[b + 2];
    const f = i / nseg;
    p1[o + 3] = w * (1.0 - 0.45 * f);
    kk[q * 2] = k0 + (k1 - k0) * f;
  }
  return q;
}

// Grow channel `slot` from (tx, ty, tz) at the cloud base toward (fx, fy, fz) above the
// sea. Trunk: 64 segments. Branches: nb of them, leaving the trunk between 15% and 65%
// of the way down, deviating 20-45 degrees, 25-45% of the remaining drop.
function grow(slot, tx, ty, tz, fx, fy, fz, nb) {
  const W = GLASS.lightning.width;
  let q = slot * SEG_PER;
  pts[0] = tx; pts[1] = ty; pts[2] = tz;
  pts[SEG_MAIN * 3] = fx; pts[SEG_MAIN * 3 + 1] = fy; pts[SEG_MAIN * 3 + 2] = fz;
  const drop = ty - fy;
  subdiv(0, SEG_MAIN, drop * 0.16);
  // Light anchor: 30% up from the foot (index 70% along the trunk).
  const ia = Math.round(SEG_MAIN * 0.7) * 3;
  bLX[slot] = pts[ia]; bLY[slot] = pts[ia + 1]; bLZ[slot] = pts[ia + 2];
  bTX[slot] = tx; bTZ[slot] = tz;
  q = emit(q, SEG_MAIN, W, 1.0, 0.85);
  // The scratch is reused for each branch, so copy the branch roots off the trunk first.
  for (let b = 0; b < nb; b++) {
    const ri = Math.round(SEG_MAIN * rng(0.15, 0.65)) * 3;
    _root[b * 3] = pts[ri]; _root[b * 3 + 1] = pts[ri + 1]; _root[b * 3 + 2] = pts[ri + 2];
  }
  for (let b = 0; b < BR_MAX; b++) {
    if (b >= nb) { q = emitDead(q, SEG_BR); continue; }
    const r = b * 3;
    const rx = _root[r], ry = _root[r + 1], rz = _root[r + 2];
    const rem = ry - fy;
    const ang = rng(0, Math.PI * 2), dev = rng(0.36, 0.78);   // 20-45 degrees off the drop
    const len = rem * rng(0.25, 0.45);
    pts[0] = rx; pts[1] = ry; pts[2] = rz;
    pts[SEG_BR * 3]     = rx + Math.cos(ang) * len * Math.sin(dev);
    pts[SEG_BR * 3 + 1] = ry - len * Math.cos(dev);
    pts[SEG_BR * 3 + 2] = rz + Math.sin(ang) * len * Math.sin(dev);
    subdiv(0, SEG_BR, len * 0.18);
    q = emit(q, SEG_BR, W * 0.55, 0.45, 0.08);
  }
  const start = slot * SEG_PER;
  aP0.addUpdateRange(start * 4, SEG_PER * 4); aP0.needsUpdate = true;
  aP1.addUpdateRange(start * 4, SEG_PER * 4); aP1.needsUpdate = true;
  aK.addUpdateRange(start * 2, SEG_PER * 2); aK.needsUpdate = true;
}
const _root = new Float32Array(BR_MAX * 3);
function emitDead(q, nseg) {
  const p1 = aP1.array;
  for (let i = 0; i < nseg; i++, q++) p1[q * 4 + 3] = 0;
  return q;
}

// --- firing -----------------------------------------------------------------------
// Place a bolt for main stroke k of the deal and start it at clock t0 with `amp`.
// Position is a pure function of the seed: a bearing round the raft (the world origin,
// where the raft is moored) and a range class -- a quarter land near (35-70 u, a strike
// that lights the deck hard), most out over the sea (90-220), a few far (250-400).
// The channel drifts laterally as it drops (a strike leans with the storm's wind).
function fireSeeded(dealSeed, k, t0, amp, tt, pulses, np) {
  seedFor(dealSeed, k);
  const bearing = rng(0, Math.PI * 2);
  const cls = rnd();
  const dist = cls < 0.25 ? rng(35, 70) : cls < 0.85 ? rng(90, 220) : rng(250, 400);
  const x = Math.cos(bearing) * dist, z = Math.sin(bearing) * dist;
  fireAt(x, z, amp, t0, tt, pulses, np, 2 + Math.floor(rnd() * 3), rng(0, Math.PI * 2), rng(0.05, 0.25));
}

// Fire a channel whose trunk TOP is at (x, z). `pulses`/`np` are the return strokes
// (offsets from t0 + amplitudes) or null for a synthetic 3-pulse train.
function fireAt(x, z, amp, t0, tt, pulses, np, nb, leanAng, leanK) {
  // Take the slot that is free, else the one that has been burning longest.
  let slot = -1, oldest = 1e18;
  for (let i = 0; i < POOL; i++) {
    if (!bLive[i]) { slot = i; break; }
    if (bT0[i] < oldest) { oldest = bT0[i]; slot = i; }
  }
  const top = GLASS.puff.deckY - rng(5, 25);
  const foot = SURFACE_Y + rng(4, 14);
  const lean = (top - foot) * leanK;
  grow(slot, x, top, z, x + Math.cos(leanAng) * lean, foot, z + Math.sin(leanAng) * lean, nb);
  bT0[slot] = t0; bAmp[slot] = amp; bLive[slot] = 1;
  if (pulses) {
    bNP[slot] = np;
    for (let i = 0; i < np; i++) { bPT[slot * MAX_PULSES + i] = pulses[i * 2]; bPA[slot * MAX_PULSES + i] = pulses[i * 2 + 1]; }
  } else {
    bNP[slot] = 3;
    bPT[slot * MAX_PULSES] = 0;     bPA[slot * MAX_PULSES] = amp;
    bPT[slot * MAX_PULSES + 1] = 0.12; bPA[slot * MAX_PULSES + 1] = amp * 0.45;
    bPT[slot * MAX_PULSES + 2] = 0.27; bPA[slot * MAX_PULSES + 2] = amp * 0.30;
  }
  last.x = bLX[slot]; last.y = bLY[slot]; last.z = bLZ[slot]; last.t = t0; last.amp = amp;
  last.top = top; last.tx = x; last.tz = z; last.n++;
  return slot;
}
const last = { x: 0, y: 0, z: 0, t: -1e9, amp: 0, top: 0, tx: 0, tz: 0, n: 0 };
const _pulses = new Float32Array(MAX_PULSES * 2);

// Schedule bookkeeping: which main stroke has been fired (by clock), and the deal it
// belonged to. A re-deal or a scrub backwards resets it.
let firedT = -1e9, firedGen = -1;
let stormNow = 0;

// --- frame ------------------------------------------------------------------------
const _col = new THREE.Color();
export function updateLightning(dt, wx, rm) {
  if (!mesh) return;
  const L = GLASS.lightning;
  const tt = wx.clock;
  stormNow = wx.storm;

  // Colour temperature: cold blue-white at 0, plain white at 1. The light's colour
  // carries the flat diffuse reflectance (see GLSL_BOLT in water.js).
  const tp = L.temp;
  const r = 0.70 + 0.28 * tp, g = 0.78 + 0.20 * tp, b = 0.98 + 0.02 * tp;
  uCol.value.set(r, g, b);
  const ALB = 0.36;
  setBoltParams(r * ALB, g * ALB, b * ALB, L.floor, L.depthK);
  uWidthK.value = 1;

  // --- fire from the schedule ---
  const S = lightningSchedule();
  if (S.gen !== firedGen || tt < firedT - 1) { firedGen = S.gen; firedT = -1e9; }
  if (wx.storm > 0.55) {
    for (let i = 0; i < S.n; i++) {
      if (!S.main[i]) continue;
      const t0 = S.t[i];
      if (t0 > tt || t0 <= firedT || tt - t0 > 0.25) continue;
      firedT = t0;
      // rate bias: < 1 skips a seeded share of strokes; > 1 twins the rest.
      seedFor(S.seed, i + 977);
      const roll = rnd();
      if (L.rate < 1 && roll > L.rate) continue;
      let np = 0;
      _pulses[np * 2] = 0; _pulses[np * 2 + 1] = S.a[i]; np++;
      for (let j = i + 1; j < S.n && !S.main[j] && np < MAX_PULSES; j++) { _pulses[np * 2] = S.t[j] - t0; _pulses[np * 2 + 1] = S.a[j]; np++; }
      fireSeeded(S.seed, i, t0, S.a[i] * wx.storm, tt, _pulses, np);
      if (L.rate > 1 && roll < L.rate - 1) fireSeeded(S.seed, i + 5000, t0 + rng(0.06, 0.12), S.a[i] * 0.7 * wx.storm, tt, null, 0);
    }
  }

  // --- envelopes ---
  let live = 0, maxQ = 0;
  const rmK = rm ? 0.25 : 1;
  for (let s = 0; s < POOL; s++) {
    if (!bLive[s]) { bCore[s] = bGlow[s] = bI[s] = 0; continue; }
    const tau = tt - bT0[s];
    const np = bNP[s];
    const tLast = bPT[s * MAX_PULSES + np - 1];
    if (tau < -0.001 || tau > tLast + LIFE_AFTER) { bLive[s] = 0; bCore[s] = bGlow[s] = bI[s] = 0; continue; }
    let core = 0, glow = 0;
    for (let p = 0; p < np; p++) {
      const d = tau - bPT[s * MAX_PULSES + p];
      if (d < 0) break;
      // A 25 ms hold at the peak before the decay: a stroke is shorter than a frame,
      // and without the hold the frame that follows it has already lost most of it.
      core += bPA[s * MAX_PULSES + p] * Math.exp(-Math.max(d - PULSE_HOLD, 0) / PULSE_TAU);
      // The afterimage restarts at every pulse: the channel is re-heated each time.
      const gl = L.after * bAmp[s] * Math.exp(-d / AFTER_TAU);
      if (gl > glow) glow = gl;
    }
    core *= rmK; glow *= rmK;
    bCore[s] = core; bGlow[s] = glow;
    bI[s] = L.peak * (core + 0.35 * glow);
    live++;
    const q = (s + 1) * SEG_PER;
    if (q > maxQ) maxQ = q;
  }
  for (let s = 0; s < POOL; s++) uBolt.value[s].set(bCore[s], bGlow[s], 0, 0);

  // --- the light: two strongest ---
  let i0 = -1, i1 = -1;
  for (let s = 0; s < POOL; s++) {
    if (bI[s] <= 0) continue;
    if (i0 < 0 || bI[s] > bI[i0]) { i1 = i0; i0 = s; }
    else if (i1 < 0 || bI[s] > bI[i1]) i1 = s;
  }
  if (i0 >= 0) setBoltLight(0, bLX[i0], bLY[i0], bLZ[i0], bI[i0]); else setBoltLight(0, 0, 0, 0, 0);
  if (i1 >= 0) setBoltLight(1, bLX[i1], bLY[i1], bLZ[i1], bI[i1]); else setBoltLight(1, 0, 0, 0, 0);
  // DEV hold (__bolt.hold): a steady slot-0 light for screenshots -- a real stroke is
  // two frames, which is impossible to photograph. Never set by the game.
  if (hold[3] > 0) setBoltLight(0, hold[0], hold[1], hold[2], hold[3]);

  // --- the ribbons ---
  // Below 120 units the abyss never sees weather (weather.js's own depth fade); the
  // ribbons shed there and under the degrade ladder (`ribbons` false) -- the LIGHT
  // never sheds, it is four uniforms.
  const show = live > 0 && ribbonsOn && camera.position.y > -120;
  mesh.visible = show;
  geo.instanceCount = show ? maxQ : 0;
}

const hold = new Float32Array(4);
let ribbonsOn = true;
export function setBoltRibbons(on) { ribbonsOn = !!on; }

// --- dev probe --------------------------------------------------------------------
function installProbe() {
  if (typeof window === 'undefined') return;
  const st = { live: 0, slots: [], light: [null, null], programs: 0 };
  window.__bolt = {
    // Fire a bolt now with its trunk over (x, z), strength 0..1 (default 1). A synthetic
    // 3-pulse train. Returns the slot.
    fire(x, z, strength) {
      const s = strength === undefined ? 1 : strength;
      const tt = window.weather ? window.weather.state().clock : 0;
      rs = (Math.floor(tt * 1000) ^ 0x1234567) | 0;
      return fireAt(x === undefined ? 120 : x, z === undefined ? 0 : z, s, tt, tt, null, 0, 3, rng(0, Math.PI * 2), 0.15);
    },
    // The most recent strike, for audio: world anchor, clock, amplitude, trunk top.
    last() { return { x: last.x, y: last.y, z: last.z, t: last.t, amp: last.amp, top: last.top, tx: last.tx, tz: last.tz, n: last.n }; },
    state() {
      st.live = 0; st.slots.length = 0;
      for (let s = 0; s < POOL; s++) {
        if (!bLive[s]) continue;
        st.live++;
        st.slots.push({ slot: s, t0: bT0[s], amp: bAmp[s], core: bCore[s], glow: bGlow[s], I: bI[s], x: bLX[s], y: bLY[s], z: bLZ[s], pulses: bNP[s] });
      }
      st.ribbons = ribbonsOn; st.visible = !!(mesh && mesh.visible); st.instances = geo ? geo.instanceCount : 0;
      st.storm = stormNow; st.firedT = firedT;
      return st;
    },
    ribbons(on) { setBoltRibbons(on); return ribbonsOn; },
    // Hold a steady light at (x, y, z) with intensity I (0 or no args = release).
    hold(x, y, z, I) { hold[0] = x || 0; hold[1] = y || 0; hold[2] = z || 0; hold[3] = I || 0; return Array.from(hold); }
  };
}
