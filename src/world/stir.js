// ABYSSA — stir.js. OWNED BY: anim-fauna (the living world's motion track).
//
// THE SEA'S NERVOUS SYSTEM. One small shared blackboard that every animal and every
// plant reads, so a sonar ping, a sleeper's footfall, a shark's pass or Sal pushing
// through a meadow is felt by the WHOLE sea at once instead of by whichever module
// happened to be wired to it. Nothing here renders; nothing here allocates per frame.
//
//   MOVERS  — fixed slots for the big bodies that part schools and plants: Sal, the
//             waking sleeper, the shark(s), the ray, the turtles. A slot is written by
//             its owner every frame it lives and is ignored once it goes stale (0.25 s),
//             so module update ORDER never matters (predators run after creatures).
//   PULSES  — a ring of 8 startle events: an expanding front (sonar: 36 u/s out to
//             120) or an instant burst (knife strike, sleeper slam, footfall, shark
//             bite). Readers ask pulseAt(x,y,z) for "has a front just crossed me".
//   LANTERN — the lamp's live world position and brightness (predators.js publishes
//             the value game.js hands it; everything else reads it one frame late).
//   PUSH    — six world-space interaction spheres (vec4 xyz + radius) plus their
//             velocities, uploaded as uniform arrays shared by flora/gardens: the
//             plants part around whatever is brushing through them.
//
// Inputs this module gathers itself (nothing outside the fauna track is edited):
//   - Sal: player.pos / player.vel every frame.
//   - the sleeper: window.lev (the live sleeper object: pos, bodyY, R, feet, dormant).
//     Footfalls are the brooder's planted-foot edges (f.t leaving the swing).
//   - the sonar: window.tools.sonar() polled at 4 Hz (a ping restarts its age).
import * as THREE from 'three';
import { player } from '../player.js';

// ---- movers ----------------------------------------------------------------------
export const M_SAL = 0, M_SLEEPER = 1, M_SHARK0 = 2, M_SHARK1 = 3, M_RAY = 4, M_TURTLE0 = 5, M_TURTLE1 = 6, M_SQUID = 7;
export const MOVER_N = 8;
// per slot: x y z r(body radius) vx vy vz fear(0..1 how frightening) t(stamp)
export const MV = new Float32Array(MOVER_N * 9);
const STALE = 0.25;
let now = 0;

export function setMover(slot, x, y, z, r, vx, vy, vz, fear) {
  const o = slot * 9;
  MV[o] = x; MV[o + 1] = y; MV[o + 2] = z; MV[o + 3] = r;
  MV[o + 4] = vx; MV[o + 5] = vy; MV[o + 6] = vz; MV[o + 7] = fear; MV[o + 8] = now;
}
export function moverLive(slot) { return now - MV[slot * 9 + 8] < STALE && MV[slot * 9 + 3] > 0; }
export function clearMover(slot) { MV[slot * 9 + 3] = 0; }

// ---- pulses ----------------------------------------------------------------------
// per pulse: x y z t0 speed(0 = instant) reach k kind
export const PULSE_N = 8;
export const PU = new Float32Array(PULSE_N * 8);
let pHead = 0;
export const P_SONAR = 1, P_STRIKE = 2, P_SLAM = 3, P_STEP = 4, P_BITE = 5;
for (let i = 0; i < PULSE_N; i++) PU[i * 8 + 3] = -1e9;

// uJolt: the last strong pulse for GPU readers (x, z, current front radius, strength).
// A sonar front grows outward at its speed; the strength holds briefly then decays over
// ~3.5 s, which is the slow re-emergence of everything that flinched.
export const uJolt = { value: new THREE.Vector4(0, 0, 0, 0) };
let jT0 = -1e9, jX = 0, jZ = 0, jReach = 0, jSpeed = 0, jK = 0;
export function stirPulse(x, y, z, reach, speed, k, kind) {
  if (k >= 0.5) { jT0 = now; jX = x; jZ = z; jReach = reach; jSpeed = speed; jK = Math.min(1, k); }
  const o = pHead * 8;
  PU[o] = x; PU[o + 1] = y; PU[o + 2] = z; PU[o + 3] = now; PU[o + 4] = speed; PU[o + 5] = reach; PU[o + 6] = k; PU[o + 7] = kind;
  pHead = (pHead + 1) % PULSE_N;
}

// The strongest startle a point feels RIGHT NOW from any live pulse: an expanding front
// is felt for the 0.35 s it takes to cross, an instant burst for its first 0.3 s, both
// falling off with distance. The direction (away from the source) is left in PULSE_DIR.
export const PULSE_DIR = { x: 0, y: 0, z: 0 };
export function pulseAt(x, y, z) {
  let best = 0;
  for (let i = 0; i < PULSE_N; i++) {
    const o = i * 8, age = now - PU[o + 3];
    if (age < 0 || age > 4) continue;
    const dx = x - PU[o], dy = y - PU[o + 1], dz = z - PU[o + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-4, reach = PU[o + 5];
    if (d > reach) continue;
    let k;
    if (PU[o + 4] > 0) {
      const front = age * PU[o + 4];
      const lag = front - d;                       // how long ago (in units) the front passed
      if (lag < 0 || lag > PU[o + 4] * 0.35) continue;
      k = 1 - lag / (PU[o + 4] * 0.35);
    } else {
      if (age > 0.3) continue;
      k = 1 - age / 0.3;
    }
    k *= PU[o + 6] * (1 - d / reach * 0.7);
    if (k > best) { best = k; PULSE_DIR.x = dx / d; PULSE_DIR.y = dy / d; PULSE_DIR.z = dz / d; }
  }
  return best;
}

// ---- lantern -----------------------------------------------------------------------
export const LANT = { x: 0, y: 0, z: 0, k: 0 };
export function setLantern(p, k) { LANT.x = p.x; LANT.y = p.y; LANT.z = p.z; LANT.k = k; }

// ---- plant push spheres (GPU) --------------------------------------------------------
export const PUSH_N = 6;
export const uPush = { value: Array.from({ length: PUSH_N }, () => new THREE.Vector4(0, -1e5, 0, 0)) };
export const uPushV = { value: Array.from({ length: PUSH_N }, () => new THREE.Vector3()) };
// GLSL: the displacement a vertex at world point wp gets from the push spheres. Returned
// in WORLD units; callers rotate it into their instance's local frame. The push is
// horizontal (plants bend, they do not lift), grows with the part's flex, and carries a
// share of the mover's velocity so a stem is dragged along the way the body passes.
export const PUSH_GLSL = `
uniform vec4 uPush[${PUSH_N}]; uniform vec3 uPushV[${PUSH_N}];
vec3 stirPush(vec3 wp, float flex){
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${PUSH_N}; i++) {
    vec4 s = uPush[i];
    vec3 d = wp - s.xyz;
    float rr = s.w * 1.9;
    float dd = length(d.xz);
    if (s.w <= 0.0 || dd > rr || abs(d.y) > rr * 1.4) continue;
    float k = 1.0 - smoothstep(s.w * 0.35, rr, dd);
    k *= 1.0 - smoothstep(rr * 0.6, rr * 1.4, abs(d.y));
    vec2 away = dd > 1e-3 ? d.xz / dd : vec2(1.0, 0.0);
    vec2 drag = uPushV[i].xz * 0.22;
    float dl = length(drag); drag *= dl > 0.9 ? 0.9 / dl : 1.0;
    acc.xz += (away * s.w * 0.55 + drag) * k * flex;
    acc.y -= k * flex * s.w * 0.12;
  }
  return acc;
}`;

// ---- the tick ------------------------------------------------------------------------
let lastT = -1, sonarPoll = 0, sonarAge = 99, lastFeetT = null, stepCool = 0;
const _ppos = new THREE.Vector3();

// Called at the top of the frame by whichever of the owning modules runs first (flora);
// idempotent per timestamp, so later callers are free.
export function tickStir(dt, t) {
  if (t === lastT) return;
  lastT = t; now = t;
  // Sal: a diver is a big, slow, bubbling shape; fear rises with how fast he moves
  const pv = player.vel, sp = Math.sqrt(pv.x * pv.x + pv.y * pv.y + pv.z * pv.z);
  setMover(M_SAL, player.pos.x, player.pos.y + 0.9, player.pos.z, 1.0, pv.x, pv.y, pv.z, 0.35 + Math.min(0.65, sp / 6));

  // the sleeper: whatever kind is live. Dormant sleepers are ridges, not threats.
  const L = typeof window !== 'undefined' ? window.lev : null;
  if (L && L.pos && !L.dormant && !L.calmed) {
    const y = L.bodyY !== undefined ? L.bodyY : L.pos.y;
    const r = Math.max(4, (L.R || 5) * 1.6);
    const v = L.vel;
    setMover(M_SLEEPER, L.pos.x, y, L.pos.z, r, v ? v.x : 0, v ? v.y : 0, v ? v.z : 0, 1);
    // footfalls: a planted foot ends its swing (brooder gait)
    const F = L.feet;
    if (F && F.length) {
      if (!lastFeetT || lastFeetT.length !== F.length) lastFeetT = new Float32Array(F.length).fill(-1);
      stepCool -= dt;
      for (let i = 0; i < F.length; i++) {
        const f = F[i];
        if (lastFeetT[i] >= 0 && f.t < 0 && stepCool <= 0 && f.cur) { stirPulse(f.cur.x, f.cur.y, f.cur.z, 34, 0, 0.7, P_STEP); stepCool = 0.12; }
        lastFeetT[i] = f.t;
      }
    }
  } else clearMover(M_SLEEPER);

  // sonar: a restarted age is a new ping from wherever Sal stood
  sonarPoll -= dt;
  if (sonarPoll <= 0 && typeof window !== 'undefined' && window.tools && window.tools.sonar) {
    sonarPoll = 0.25;
    const a = window.tools.sonar().age;
    if (a < sonarAge && a < 1) {
      _ppos.copy(player.pos);
      // back-date the front so it is where the ring is now
      stirPulse(_ppos.x, _ppos.y, _ppos.z, 120, 36, 1, P_SONAR);
      PU[((pHead + PULSE_N - 1) % PULSE_N) * 8 + 3] = now - a;
      jT0 = now - a;
    }
    sonarAge = a;
  }

  // the jolt front for the plants
  const ja = now - jT0;
  uJolt.value.set(jX, jZ, jSpeed > 0 ? Math.min(jReach, ja * jSpeed) : jReach,
    ja < 0 ? 0 : jK * (ja < 0.25 ? 1 : Math.max(0, 1 - (ja - 0.25) / 3.5)) * (jSpeed > 0 ? 1 : 0.8));

  // plant push spheres: the six live movers nearest the camera's subject (Sal)
  let k = 0;
  for (let s = 0; s < MOVER_N && k < PUSH_N; s++) {
    if (!moverLive(s)) continue;
    const o = s * 9;
    const dx = MV[o] - player.pos.x, dz = MV[o + 2] - player.pos.z;
    if (s !== M_SAL && dx * dx + dz * dz > 160 * 160) continue;
    uPush.value[k].set(MV[o], MV[o + 1], MV[o + 2], s === M_SAL ? 1.25 : MV[o + 3]);
    uPushV.value[k].set(MV[o + 4], MV[o + 5], MV[o + 6]);
    k++;
  }
  for (; k < PUSH_N; k++) uPush.value[k].w = 0;
}

export function stirNow() { return now; }

if (typeof window !== 'undefined') {
  window.__stir = {
    MV, PU,
    pulse: (x, y, z, reach = 40, speed = 0, k = 1) => { stirPulse(x, y, z, reach, speed, k, P_STRIKE); return 'pulse'; },
    at: (x, y, z) => pulseAt(x, y, z),
    live: () => { const o = []; for (let s = 0; s < MOVER_N; s++) if (moverLive(s)) o.push(s); return o; }
  };
}
