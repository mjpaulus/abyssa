// The umbilical: a heavy rubber-and-canvas air hose from the raft's pump to Sal's helmet.
// Also owns THE LEASH (see the block above leashStep): elastic give, a firm hold at full
// stretch, and a speed-scaled yank when he arrives at the end of it.
// OWNED BY: orchestrator.
//
// The rope is a verlet/PBD chain with anisotropic water drag. Three things here are
// load-bearing and were each measured wrong before being fixed; do not "simplify" them
// back without re-measuring:
//   1. There is NO Laplacian smoothing pass. Repeated Laplacian smoothing with pinned
//      endpoints converges to the straight line — that single pass is what made the old
//      hose a rigid pole with 0.00 deg of bend at every joint beyond 40 m.
//   2. The segment length constraint is SYMMETRIC. A one-sided ("rope not spring")
//      constraint lets the solver hide 12-27% of the paid-out line as compressed
//      segments, and the hidden length comes back as a 40-deg-per-joint accordion.
//   3. Bending is modelled twice, and it needs both: a weak restoring force (KB, which
//      makes long-wavelength sag cheaper than short-wavelength crumple) and a hard
//      one-sided cap on the sagitta (which forbids folds the polyline cannot draw).
//      With only the cap, the chain locks into a slack-storing helix and never unwinds.
import * as THREE from 'three';
import { scene, envTexDeep as envTex } from '../core.js';
import { V3, clamp, fbm } from '../lib/math.js';
import { terrainH } from '../world/terrain.js';
import { survival } from './survival.js';
import { pumpPos, raft } from './raft.js';
import { resolveHoseNode, HOSE_BOUND_R2 } from './raft/colliders.js';
import { airInletWorldPos } from '../entities/diver.js';
import { braidSet } from '../lib/textures.js';
import { registerPaint } from '../lib/paint.js';

// ---------------------------------------------------------------------------
// Geometry / topology
// ---------------------------------------------------------------------------
// SEG is 63 because ending.js finds the umbilical by shape — `o.isInstancedMesh &&
// o.count === 63 && geometry.type === 'CylinderGeometry'` — and hides it for the
// cinematic. Keeping every chunk at exactly 63 instances preserves that match, so the
// rope can be as long as the physics needs without breaking a file this module does not
// own. If ending.js ever switches to setTetherVisible(), collapse this back to one mesh.
const SEG = 63;
const CHUNKS = 2;
const M = SEG * CHUNKS;          // rope segments
const N = M + 1;                 // rope nodes
const RAD = 0.065;               // 130 mm hose — deliberately over-scale for readability
const EXT = RAD * 0.6;           // per-instance overlap that hides the wedge gap at bends

// ---------------------------------------------------------------------------
// Physics. Derived in an offline prototype of this exact solver and then re-measured
// in-browser; the numbers in the comments are what each one buys.
// ---------------------------------------------------------------------------
// Net weight over effective mass. A waterlogged rubber/canvas hose is ~1.35x seawater,
// and a cylinder accelerating sideways entrains its own volume again (added mass Ca=1),
// so rho_eff ~ 2.15 rho_w and g_net = 9.81*(1.35-1)/2.15 ~ 1.4, not 9.81.
const GRAVITY = -1.40;
// Morison drag divided by mass per unit length, so both are 1/m and independent of how
// the rope happens to be discretised:
//   k_n = rho*C_D/(pi*r*rho_eff) = 1.2/(pi*0.065*2.15) = 2.73
//   k_t = rho*C_f/(r*rho_eff)    = 0.02/(0.065*2.15)   = 0.14
// The ~20:1 ratio is the whole feel: a cylinder slides freely along its own axis and
// refuses to move across it, which is what makes the hose trail, bow and overshoot.
// (C_f = 0.02 is ~4x a realistic smooth-cylinder skin friction; it errs toward LESS
// free sliding, so if the hose ever feels reluctant to pay through itself, lower DRAG_T.)
const DRAG_N = 2.9;
const DRAG_T = 0.15;
const NUM_DAMP = 0.06;           // 1/s numerical bleed only, not physics
// Bending stiffness as a restoring acceleration toward the neighbour midpoint. Acts like
// a string tension: it costs the rope nothing to sag over 200 m and a great deal to
// crumple over 1 m, so slack migrates into a belly instead of a corkscrew. Measured:
// KB below ~25 or above ~50 and the chain locks at the sagitta cap (mean joint bend
// 10-17 deg); at 32 it settles to 0.6 deg with a 23 m belly.
const KB = 32;                   // 1/s^2
const KB_MAX = 0.3;              // impulse clamp: never move a node past 0.3x the sagitta
// Hard one-sided limit on the sagitta. Two terms: a physical minimum bend radius
// (~7x hose diameter) and a discretisation guard of 4 segment-lengths of radius, which
// is what stops the polyline from drawing a corner it cannot represent as a curve.
const R_MIN = 0.45;              // m
const TAN_MAX = 0.125;           // sagitta/half-chord -> 14.3 deg per joint
const BEND_GAIN = 0.5;
const ITER = 8;                  // constraint relaxation passes

// Tender. `deployed` is state with hysteresis, not a function of range: pay-out is
// instant and unconditional (measured player top speed is 31.8 m/s with the thruster —
// any rate limit here would be a leash, which the user rejected), retrieval is slow.
const SLACK = 0.02;              // excess line as a fraction of the straight-line range
const SLACK_MIN = 2.0;           // m of excess even at zero range
const RETRIEVE = 0.6;            // m/s the tender hauls back in
const EXCESS_MAX = 8;            // hard cap on slack beyond `want` — see the ascent note below
const SEG_FINE = 0.40;           // rest length of the segment at Sal's shoulder
const FINE = 40;                 // segments that absorb an un-retrieved bight
// Slack lives at the ANCHOR end, not the diver's. This was 0.5 — half of all excess
// line parked in coils at Sal's backpack — and the user read it exactly right
// (2026-08-02): "the hose feels like it originates from Sal's air tank on his back
// when it should be reeled from the raft." The reel IS on the raft, so un-retrieved
// line hangs under the tender up top. At 0 the geometric rest-length grading absorbs
// all excess into the long anchor-end segments on its own; the fine segments at Sal's
// shoulder stay at SEG_FINE and the line leaves his inlet clean.
const BIGHT = 0.0;
const BIGHT_MAX = 25;            // m

// Seabed
const MU_RATE = 4.0;             // 1/s sliding friction (as 1-exp(-MU_RATE*h), not per frame)
// m of lateral drift before a node re-samples terrainH. On a 0.4 gradient this is the
// depth a resting node can sink below the true surface before the cache catches up;
// 0.3 m keeps that under the hose radius on all but cliff faces.
const FLOOR_EPS = 0.3;

// Integration
const FIXED = 1 / 60;
const MAXSUB = 4;                // dt is split into <=4 equal steps, never truncated

const RIB_PITCH = 0.12;          // m of world arc per corrugation rib — constant, always

// ---------------------------------------------------------------------------
// Minimum screen width. The hose is 2*RAD = 0.13 units across, so past
// dv = 0.13*uPix/TETHER_MIN_PX it covers less than one and a half pixels and the
// rasteriser drops it to a dashed ghost and then to nothing — exactly where it would
// otherwise be the best scale cue in the game, and the only one that reads along the
// VERTICAL axis. The floor is in BACKING-STORE pixels, not CSS pixels, because that is
// where the dropout happens; the crossover therefore lands at 72 m on a 1080-tall buffer
// and at 149 m on a 2256-tall one (measured). RAD itself cannot move: it feeds EXT, the
// seabed contact offset, and ending.js finds the umbilical by shape alone. So the
// widening is done in the vertex shader on the unit-radius cylinder, BEFORE instanceMatrix
// applies RAD, and it is a max() against 1.0 — inside the crossover distance not one bit
// of the near-field silhouette changes.
const TETHER_MIN_PX = 1.4;
// px of canvas per world unit at 1 unit of view depth; same form as water.js's pixScale.
// The 900 default only matters for the frames before the first onBeforeRender.
const uPix = { value: 900 };
const uMinPx = { value: TETHER_MIN_PX };
const _vpSize = new THREE.Vector2();

// ---------------------------------------------------------------------------
// State. Typed arrays throughout: zero allocation after build.
// ---------------------------------------------------------------------------
const px = new Float64Array(N), py = new Float64Array(N), pz = new Float64Array(N);
const vx = new Float64Array(N), vy = new Float64Array(N), vz = new Float64Array(N);
const ox = new Float64Array(N), oy = new Float64Array(N), oz = new Float64Array(N);
const rest = new Float64Array(M), cum = new Float64Array(N), w = new Float64Array(N);
const jit = new Float64Array(M);
// Terrain is time-invariant, so each node caches the floor height under it and only
// re-samples after drifting FLOOR_EPS laterally. In steady state this is ~0 calls/frame
// against 126 calls/substep for the naive version.
const flH = new Float64Array(N), flX = new Float64Array(N), flZ = new Float64Array(N);
const flOK = new Uint8Array(N);
const arcAttr = [];              // one Float32Array per chunk: world arc at each instance base

let anchor = V3(0, -1.2, 0);
const meshes = [];
let deployed = 0, restFor = -1, clockT = 0, primed = false, lastZi = -1;
let contacts = 0, deckContacts = 0;
// THE DECK (polish-leftovers-oct). The raft's world matrix and its inverse, refreshed once
// a frame in updateTether; substep() takes nodes near the raft into raft-local space and
// lets raft/colliders.js resolveHoseNode push them out of the planks, the gear and the
// gallows struts. Scalars + one scratch vector: no allocation.
const _rInv = new THREE.Matrix4(), _rl = { x: 0, y: 0, z: 0 };
let raftOn = false, deckOn = true;   // deckOn: window.tether.deck = false is the A/B

const _d = V3(), _m = new THREE.Matrix4(), _inlet = V3();
const _q = new THREE.Quaternion(), _s = V3(), _up = V3(0, 1, 0), _p = V3();
const _pa = V3(), _ph = V3(), _cur = V3();

{ // stable per-index jitter: identical segments buckle in lockstep, which is a symmetry
  // the solver can get stuck in. +/-3% is enough to break it and is invisible.
  let s = 1;
  for (let i = 0; i < M; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; jit[i] = 1 + (s / 4294967296 - 0.5) * 0.06; }
}

// ---------------------------------------------------------------------------
// Rest-length allocation. Geometric grading from SEG_FINE at the diver up to whatever
// makes the total equal `deployed`: fine where the player's face is, coarse 200 m away
// in fog. Graded rather than stepped so no node sits on a mass discontinuity.
// Non-degenerate over the whole range — at dist 2 m every segment is 0.07 m, at 380 m
// the shortest is still 0.39 m. (A subtract-the-fine-zone split collapses 41% of the
// rope to exactly zero rest length below 30 m; that is why this solves for the ratio.)
// ---------------------------------------------------------------------------
function allocRest(dep, dist) {
  const bight = Math.min(Math.max(0, dep - dist) * BIGHT, BIGHT_MAX);
  const sf = Math.min(SEG_FINE + bight / FINE, dep / M);
  let g = 1;
  if (sf * M < dep - 1e-9) {
    let lo = 1 + 1e-7, hi = 2;
    for (let it = 0; it < 44; it++) {
      const mid = (lo + hi) * 0.5;
      if (sf * (Math.pow(mid, M) - 1) / (mid - 1) < dep) lo = mid; else hi = mid;
    }
    g = (lo + hi) * 0.5;
  }
  let sum = 0;
  for (let i = 0; i < M; i++) { rest[i] = sf * Math.pow(g, M - 1 - i) * jit[i]; sum += rest[i]; }
  const k = dep / sum;
  cum[0] = 0;
  for (let i = 0; i < M; i++) { rest[i] *= k; cum[i + 1] = cum[i] + rest[i]; }
  // inverse rest-mass, so a 0.4 m node is not yanked as hard as a 20 m one
  for (let i = 1; i < N - 1; i++) w[i] = 2 / (rest[i - 1] + rest[i]);
  w[0] = 0; w[N - 1] = 0;        // pinned: they take no correction and give the full one
}

// ---------------------------------------------------------------------------
// Ambient current. player.js owns this field but keeps it module-private and game.js
// does not pass `t` to updateTether, so it is mirrored here against a local clock.
// WIRING: exporting `sampleCurrentInto(target, pos, t)` from player.js and passing `t`
// through updateTether would delete this copy and pick up the storm multiplier, which
// this version cannot see. Sampled at 5 control nodes; the field's wavelength is ~250 m,
// so per-node sampling would be pure waste.
// ---------------------------------------------------------------------------
function sampleCurrent(x, y, z, t) {
  const s = 0.004;
  const a = fbm(x * s + t * 0.02, z * s) - 0.5;
  const b = fbm(x * s + 31, z * s + t * 0.02 + 17) - 0.5;
  return _cur.set(a, (fbm(x * s + 7, z * s + 3) - 0.5) * 0.4, b).multiplyScalar(2.2);
}
const curX = new Float64Array(5), curY = new Float64Array(5), curZ = new Float64Array(5);
function updateCurrent(t) {
  for (let k = 0; k < 5; k++) {
    const i = Math.round(k * (N - 1) / 4);
    const c = sampleCurrent(px[i], py[i], pz[i], t);
    curX[k] = c.x; curY[k] = c.y; curZ[k] = c.z;
  }
}

// ---------------------------------------------------------------------------
// Long-range inequality constraints. Gauss-Seidel only propagates tension ITER nodes per
// pass, so a 126-segment chain under real gravity stretches several percent at long span
// no matter how many local iterations it gets. A rope may be closer than its arc length,
// never further — so these correct one way only.
// ---------------------------------------------------------------------------
function lrCon(i, j) {
  const r = cum[j] - cum[i];
  let dx = px[j] - px[i], dy = py[j] - py[i], dz = pz[j] - pz[i];
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d <= r || d < 1e-9) return;
  const wi = w[i], wj = w[j], ws = wi + wj;
  if (ws <= 0) return;
  const f = (d - r) / d / ws;    // weighted split: a pinned end gives the free node all of it
  dx *= f; dy *= f; dz *= f;
  px[i] += dx * wi; py[i] += dy * wi; pz[i] += dz * wi;
  px[j] -= dx * wj; py[j] -= dy * wj; pz[j] -= dz * wj;
}
const LR1 = 32, LR2 = 8;
function lrPass() {
  for (let i = 0; i + LR1 <= M; i += 8) lrCon(i, i + LR1);
  lrCon(M - LR1, M);             // the stride loops stop short of the diver; he is the end
  for (let i = 0; i + LR2 <= M; i += 4) lrCon(i, i + LR2);
  lrCon(M - LR2, M);
}

// ---------------------------------------------------------------------------
function substep(h, ax, ay, az, hx, hy, hz, zi) {
  const nd = 1 - NUM_DAMP * h;
  const kb = Math.min(KB * h, KB_MAX / h);
  for (let i = 1; i < N - 1; i++) {
    // current at this node, lerped between the 5 control samples
    const f = i * 4 / (N - 1), k0 = f | 0, k1 = k0 < 4 ? k0 + 1 : 4, u = f - k0;
    const cx = curX[k0] + (curX[k1] - curX[k0]) * u;
    const cy = curY[k0] + (curY[k1] - curY[k0]) * u;
    const cz = curZ[k0] + (curZ[k1] - curZ[k0]) * u;

    let ux = vx[i] - cx, uy = vy[i] - cy, uz = vz[i] - cz;   // into the water's frame
    let tx = px[i + 1] - px[i - 1], ty = py[i + 1] - py[i - 1], tz = pz[i + 1] - pz[i - 1];
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1e-6;
    tx /= tl; ty /= tl; tz /= tl;
    const vt = ux * tx + uy * ty + uz * tz;
    const nx = ux - vt * tx, ny = uy - vt * ty, nz = uz - vt * tz;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    // quadratic drag, impulse-clamped the way player.js clamps its own: min(1/h, k|v|)*h
    // is bounded by 1, so the worst case removes all of the velocity and never overshoots.
    const kn = Math.min(1 / h, DRAG_N * nl) * h;
    const kt = Math.min(1 / h, DRAG_T * Math.abs(vt)) * h;
    ux -= nx * kn + vt * tx * kt; uy -= ny * kn + vt * ty * kt; uz -= nz * kn + vt * tz * kt;

    vx[i] = (ux + cx) * nd; vy[i] = (uy + cy + GRAVITY * h) * nd; vz[i] = (uz + cz) * nd;
    vx[i] += ((px[i - 1] + px[i + 1]) * 0.5 - px[i]) * kb;
    vy[i] += ((py[i - 1] + py[i + 1]) * 0.5 - py[i]) * kb;
    vz[i] += ((pz[i - 1] + pz[i + 1]) * 0.5 - pz[i]) * kb;

    ox[i] = px[i]; oy[i] = py[i]; oz[i] = pz[i];
    px[i] += vx[i] * h; py[i] += vy[i] * h; pz[i] += vz[i] * h;
  }
  px[0] = ax; py[0] = ay; pz[0] = az;
  px[N - 1] = hx; py[N - 1] = hy; pz[N - 1] = hz;

  for (let k = 0; k < ITER; k++) {
    if (k < 2) lrPass();
    for (let i = 1; i < N - 1; i++) {
      // reference half-chord from REST lengths, not measured positions: under compression
      // the measured chord collapses and the cap would quietly scale itself away
      const href = 0.5 * (rest[i - 1] + rest[i]);
      const smax = Math.min(TAN_MAX * href, href * href / (2 * R_MIN));
      const mx = (px[i - 1] + px[i + 1]) * 0.5, my = (py[i - 1] + py[i + 1]) * 0.5, mz = (pz[i - 1] + pz[i + 1]) * 0.5;
      const sx = px[i] - mx, sy = py[i] - my, sz = pz[i] - mz;
      const s = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (s > smax && s > 1e-9) {
        const f = (s - smax) / s * BEND_GAIN;
        px[i] -= sx * f; py[i] -= sy * f; pz[i] -= sz * f;
      }
    }
    // alternate the sweep direction so the solver has no end-to-end bias
    const fwd = (k & 1) === 0;
    for (let n = 0; n < M; n++) {
      const i = fwd ? n : M - 1 - n, j = i + 1;
      const wi = w[i], wj = w[j], ws = wi + wj;
      if (ws <= 0) continue;
      let dx = px[j] - px[i], dy = py[j] - py[i], dz = pz[j] - pz[i];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const f = (d - rest[i]) / d / ws;
      dx *= f; dy *= f; dz *= f;
      px[i] += dx * wi; py[i] += dy * wi; pz[i] += dz * wi;
      px[j] -= dx * wj; py[j] -= dy * wj; pz[j] -= dz * wj;
    }
  }

  // Seabed. Lift to the surface, then bleed the horizontal verlet velocity so a resting
  // node sticks and drags a furrow instead of skating. MU_RATE is expressed per second;
  // a per-frame fraction here would weld the hose to the floor at high frame rates.
  contacts = 0;
  const mu = 1 - Math.exp(-MU_RATE * h);
  for (let i = 1; i < N - 1; i++) {
    if (!flOK[i] || Math.abs(px[i] - flX[i]) + Math.abs(pz[i] - flZ[i]) > FLOOR_EPS) {
      flH[i] = terrainH(px[i], pz[i], zi); flX[i] = px[i]; flZ[i] = pz[i]; flOK[i] = 1;
    }
    const floor = flH[i] + RAD + 0.05;
    if (py[i] < floor) {
      py[i] = floor;
      if (oy[i] < floor) oy[i] = floor;
      ox[i] += (px[i] - ox[i]) * mu;
      oz[i] += (pz[i] - oz[i]) * mu;
      contacts++;
    }
  }

  // The raft. Same contact model as the seabed: the push is positional, the inward motion
  // it removes does not come back as velocity (the old position moves with the node), and
  // a node resting on the planks drags with MU_RATE friction.
  deckContacts = 0;
  if (raftOn) {
    const W = raft.matrixWorld.elements, I = _rInv.elements;
    const rx = W[12], ry = W[13], rz = W[14];
    for (let i = 1; i < N - 1; i++) {
      const dx0 = px[i] - rx, dy0 = py[i] - ry, dz0 = pz[i] - rz;
      if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > HOSE_BOUND_R2) continue;
      const X = px[i], Y = py[i], Z = pz[i];
      _rl.x = I[0] * X + I[4] * Y + I[8] * Z + I[12];
      _rl.y = I[1] * X + I[5] * Y + I[9] * Z + I[13];
      _rl.z = I[2] * X + I[6] * Y + I[10] * Z + I[14];
      const prevY = I[1] * ox[i] + I[5] * oy[i] + I[9] * oz[i] + I[13];
      if (!resolveHoseNode(_rl, RAD, prevY)) continue;
      const nX = W[0] * _rl.x + W[4] * _rl.y + W[8] * _rl.z + W[12];
      const nY = W[1] * _rl.x + W[5] * _rl.y + W[9] * _rl.z + W[13];
      const nZ = W[2] * _rl.x + W[6] * _rl.y + W[10] * _rl.z + W[14];
      ox[i] += nX - X; oy[i] += nY - Y; oz[i] += nZ - Z;
      px[i] = nX; py[i] = nY; pz[i] = nZ;
      ox[i] += (px[i] - ox[i]) * mu; oz[i] += (pz[i] - oz[i]) * mu;
      deckContacts++;
    }
  }

  const inv = 1 / h;
  for (let i = 1; i < N - 1; i++) {
    vx[i] = (px[i] - ox[i]) * inv; vy[i] = (py[i] - oy[i]) * inv; vz[i] = (pz[i] - oz[i]) * inv;
  }
}

// ---------------------------------------------------------------------------
// Material (POLISH-PROPS 2026-09-25): the SAME braided canvas cover as Sal's own feed
// hose (lib/textures.js braidSet — the very textures diver.js binds, sampled here
// through our own uniforms so their repeat is untouched and no second set is baked),
// at Sal's braid pitch, wet-sheened like his dress. Where the two meet at his inlet
// they now read as one hose.
//
// ALONG: world arc length in the shader, NOT the segment index — segment length runs
// 0.4 m to 24 m depending on how far Sal is from the raft, so an index-driven pattern
// would make the hose's texture a function of his depth.
// AROUND: the instance frame is a shortest-arc rotation whose roll is undetermined for
// near-vertical segments and re-randomises every frame, so the instance's own azimuth
// would swim. The azimuth is taken instead in a VIEW-LOCKED frame (the segment axis and
// the eye): the braid rides the hose's length exactly and its roll is held to the
// camera, which on a braid is indistinguishable from a real roll and never flickers.
// The atan2 seam sits on the far side of the hose, which is never seen.
// The corrugation of the rubber under the cover survives as a soft normal ripple
// (RIB_PITCH, arc-driven as before), not as a lathe.
// ---------------------------------------------------------------------------
const BRAID_ALONG = 0.064;       // m of hose per braid tile along (Sal's hose: 7 per 0.45 m)
const BRAID_ROUND = 5.0;         // tiles round the circumference (0.41 m / 5 = Sal's 0.082)
function tetherMaterial() {
  const BR = braidSet();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1.0, metalness: 0.02,
    envMap: envTex, envMapIntensity: 0.3
  });
  mat.customProgramCacheKey = () => 'abyssa-tether2';   // three silently shares programs otherwise
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPix = uPix;
    sh.uniforms.uMinPx = uMinPx;
    sh.uniforms.uBraidMap = { value: BR.map };
    sh.uniforms.uBraidRough = { value: BR.rough };
    sh.uniforms.uBraidNrm = { value: BR.nrm };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aArc;
        varying float vArc;
        varying vec3 vAxisView;
        varying float vTwY;
        uniform float uPix;
        uniform float uMinPx;`)
      .replace('#include <project_vertex>', `
        // Widen to a floor of uMinPx on screen. dv is this vertex's own view depth taken
        // on the segment AXIS, so a segment running away from the eye tapers with
        // perspective instead of stepping. project_vertex is where instanceMatrix lands,
        // so transformed is still unit-radius here and k multiplies RAD exactly.
        float dv = -( modelViewMatrix * instanceMatrix * vec4( 0.0, position.y, 0.0, 1.0 ) ).z;
        float need = uMinPx * max( dv, 0.5 ) / uPix;
        float k = max( 1.0, need / ( 2.0 * ${RAD.toFixed(4)} ) );
        transformed.xz *= k;
        vArc = aArc + position.y * length(instanceMatrix[1].xyz);
        vAxisView = normalize((modelViewMatrix * vec4(instanceMatrix[1].xyz, 0.0)).xyz);
        vTwY = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;
        #include <project_vertex>`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uBraidMap, uBraidRough, uBraidNrm;
        varying float vArc;
        varying vec3 vAxisView;
        varying float vTwY;
        float ribAt(float a) { return sin(6.2831853 * a / ${RIB_PITCH.toFixed(4)}); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // view-locked braid frame (see the header): A along, S across the view, F toward it
        vec3 twA = normalize(vAxisView);
        vec3 twS = cross(twA, normalize(vViewPosition));
        twS = length(twS) > 1e-4 ? normalize(twS) : vec3(1.0, 0.0, 0.0);
        vec3 twF = cross(twS, twA);
        vec3 twN0 = normalize(vNormal);
        float twPhi = atan(dot(twN0, twS), dot(twN0, twF));
        vec2 twUV = vec2(vArc / ${BRAID_ALONG.toFixed(4)}, twPhi * ${(BRAID_ROUND / (2 * Math.PI)).toFixed(5)});
        // wet everywhere under the sea; the loop above the waterline only damp
        float twWet = 1.0 - 0.6 * smoothstep(-0.2, 0.8, vTwY);
        vec3 twAlb = texture2D(uBraidMap, twUV).rgb;
        // slow drift of tar through the cover on a metre scale (LINEAR literal)
        float tar = 0.5 + 0.5 * sin(vArc * 0.37) * sin(vArc * 0.11 + 1.7);
        twAlb = mix(twAlb, vec3(0.045, 0.036, 0.027), tar * 0.35);
        diffuseColor.rgb = twAlb * 0.8 * (1.0 - 0.35 * twWet);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = texture2D(uBraidRough, twUV).g;
        roughnessFactor = mix(roughnessFactor, 0.34, twWet * 0.8);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // braid relief in the view-locked frame: u along the axis, v round it
          vec3 bn = texture2D(uBraidNrm, twUV).xyz * 2.0 - 1.0;
          vec3 twB = cross(twA, normal);
          normal = normalize(twA * bn.x * 0.8 + twB * bn.y * 0.8 + normal * bn.z);
          // the rubber's corrugation under the cover: a soft ripple, not a lathe
          normal = normalize(normal + twA * ribAt(vArc) * 0.12);
        }`);
  };
  return mat;
}

// BRASS AT THE RAFT END: the hose-tail ferrule crimped over the line and the hex union
// nut that couples it to the davit fitting, lathed along +Y (the segment frame), base
// at the anchor. A child of the first hose chunk (whose own transform is identity, the
// instances carry world space): hiding the hose — ending.js's shape match — hides the
// fitting with it. Its matrix is written in place each update: no allocation.
function ferruleGeo() {
  const parts = [];
  const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  // sleeve over the hose, a rolled lip, two crimp grooves
  parts.push(lathe([[0.070, 0.05], [0.079, 0.052], [0.080, 0.07], [0.075, 0.078], [0.080, 0.086],
    [0.080, 0.13], [0.075, 0.138], [0.080, 0.146], [0.080, 0.19], [0.076, 0.198], [0.068, 0.2]], 20));
  // hex union nut (6-sided lathe = true flats), chamfered both faces
  parts.push(lathe([[0.03, -0.035], [0.088, -0.035], [0.098, -0.026], [0.098, 0.026], [0.088, 0.035], [0.03, 0.035]], 6));
  // collar between nut and sleeve
  parts.push(lathe([[0.060, 0.030], [0.072, 0.034], [0.072, 0.050], [0.062, 0.054]], 20));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), idx = [];
  let o = 0;
  for (const g of parts) {
    g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (g.index) for (const i of g.index.array) idx.push(i + o);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}
let ferrule = null;
const FERRULE_AT = 0.22;          // m down the line from node 0
const _one = new THREE.Vector3(1, 1, 1);

export function buildTether(anchorPos) {
  anchor.copy(anchorPos);
  for (let i = 0; i < N; i++) {
    px[i] = anchor.x; py[i] = anchor.y - i * 0.35; pz[i] = anchor.z;
    ox[i] = px[i]; oy[i] = py[i]; oz[i] = pz[i];
  }
  const mat = tetherMaterial();
  for (let c = 0; c < CHUNKS; c++) {
    const arc = new Float32Array(SEG);
    const g = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
    g.translate(0, 0.5, 0);                 // pivot at the base so scaling grows along the segment
    g.setAttribute('aArc', new THREE.InstancedBufferAttribute(arc, 1));
    const inst = new THREE.InstancedMesh(g, mat, SEG);
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.frustumCulled = false;
    inst.userData.isTether = true;          // belt and braces for ending.js's shape match
    // Guarded on isPerspectiveCamera: if anything ever renders this mesh from the shadow
    // camera, cam.fov is undefined and one NaN here would collapse the hose for the whole
    // frame, not just for that pass.
    inst.onBeforeRender = (r, s, cam) => {
      if (!cam.isPerspectiveCamera) return;
      r.getSize(_vpSize);
      uPix.value = _vpSize.y * r.getPixelRatio() / (2 * Math.tan(cam.fov * Math.PI / 360));
    };
    scene.add(inst);
    meshes.push(inst);
    arcAttr.push(arc);
  }
  ferrule = new THREE.Mesh(ferruleGeo(), registerPaint(new THREE.MeshStandardMaterial({
    color: 0xa8862f, metalness: 0.92, roughness: 0.42, envMap: envTex, envMapIntensity: 0.75
  }), { hero: true }));
  ferrule.matrixAutoUpdate = false;
  ferrule.castShadow = true;
  meshes[0].add(ferrule);
}

// A respawn TELEPORTS the diver from wherever he drowned back to the raft, but the tender
// only hauls in at RETRIEVE (0.6 m/s). Drowning at 220 m therefore leaves ~218 m of slack
// to reel in — six minutes of it — piled into a tangle around the camera the entire time,
// which reads as a bright, laggy, chaotic mess exactly when the player is trying to
// recover. The fiction already says what happened: they HAULED HIM BACK BY THE LINE, so
// the line came up with him. Snap the tender to the new range and re-lay the rope along
// it, collapsing the verlet history so the solver does not spend the next second undoing
// a 200 m fold. Nodes are spaced by REST ARC, not evenly, or the graded segment lengths
// start violated and the first substep snaps them.
export function reseatTether(player) {
  anchor.copy(pumpPos);
  // Lay to player.pos, NOT airInletWorldPos: the inlet is read off the diver mesh's world
  // matrix, and on a respawn that matrix is still at the death position until the next
  // updateDiver. Using it re-laid the rope as a straight 216 m line to where he drowned
  // while the rest lengths summed to 8 m, so the solver then had to contract it 26x and
  // produced a far worse tangle than the one this function exists to prevent. The inlet
  // is ~1 m from player.pos; the first updateTether pins it exactly.
  const dist = _d.copy(player.pos).sub(anchor).length();
  deployed = Math.min(survival.hose, dist * (1 + SLACK) + SLACK_MIN);
  allocRest(deployed, dist);
  restFor = deployed;
  for (let i = 0; i < N; i++) {
    const u = cum[i] / deployed;
    px[i] = anchor.x + (player.pos.x - anchor.x) * u;
    py[i] = anchor.y + (player.pos.y - anchor.y) * u;
    pz[i] = anchor.z + (player.pos.z - anchor.z) * u;
    ox[i] = px[i]; oy[i] = py[i]; oz[i] = pz[i];   // zero verlet velocity
  }
  // SETTLE IT BEFORE ANYONE LOOKS. A rope laid on a straight line is not at rest — its
  // rest lengths carry ~2% slack, so it has to fall into its own catenary, and it does
  // that over about a second and a half of visible wriggling. reseat runs on the frame
  // the dive begins, so that wriggle was the first thing the player ever saw. Both ends
  // are pinned inside substep(), so the solver can simply be run here against a frozen
  // world: 90 fixed steps is the 1.5 s it was taking to converge, it costs a couple of
  // milliseconds once, and it hands over a hose that is already hanging.
  flOK.fill(0);                                    // floor cache is keyed on position
  updateCurrent(clockT);
  for (let s = 0; s < 90; s++) {
    substep(FIXED, anchor.x, anchor.y, anchor.z, player.pos.x, player.pos.y, player.pos.z, 0);
  }
  // Settling leaves the nodes with whatever velocity the last step gave them; without
  // this they carry it into the first real frame and the rope breathes once on entry.
  for (let i = 0; i < N; i++) { ox[i] = px[i]; oy[i] = py[i]; oz[i] = pz[i]; }
  // The substeps lerp the pinned ends from their previous positions; without this the
  // rope gets dragged across the whole world on the frame after a teleport.
  _pa.copy(anchor); _ph.set(player.pos.x, player.pos.y, player.pos.z);
  primed = true;
  // hauled back by the line: whatever he was straining against or reeling from is over
  leash.armed = true; leash.press = 0; leash.yank = 0; leash.state = 'slack';
  survival.strain = 0; twT = 9; anPrimed = false;
  player.stagger = 0;
}

export function tetherAnchor() { return anchor; }

export function setTetherVisible(v) { for (const m of meshes) m.visible = v; }

// ---------------------------------------------------------------------------
// THE LEASH. Michael, 2026-10-04 (roadmap/hose-leash-decision.md): "stop with stretch but
// like pulls him a bit so he might go off balance. This should be speed based so the
// faster he is moving the more exagerated the pull". It replaces a dead invisible wall
// (player.pos clamped to the sphere, and the air cut the same instant). Three parts,
// all of them on Sal's VELOCITY, so nothing pops:
//   GIVE  over the last GIVE units the rubber stretches and pulls back, stiffening as s^2.
//         Off the bottom it is a spring (3.0 u/s^2 at full stretch, well under his haul):
//         it slows him and, left alone, draws him gently back. On the ground it only
//         RESISTS, as a drag proportional to his outward speed — lead boots hold a man
//         against a stretched hose, and a force cap here deadlocked the walk (measured:
//         the stride's lurch trough is ~1.5 u/s^2, the spring ate it every frame, walkP
//         is distance-keyed, so he froze at the trough 0.3 u short of the end, W held).
//         A drag can never zero a positive drive: he slows to ~55% and still arrives.
//   HOLD  at full stretch the line is a one-sided distance constraint. The crossing is
//         resolved at its TIME OF IMPACT: the outward speed goes, and the part of this
//         frame's travel that carried him past the end is reflected (by the snap's
//         restitution) instead of snapped — so there is no tunnelling at any frame rate,
//         and a man pressing into the hold sits at exactly L, frame after frame, no jitter.
//   SNAP  ARRIVING at the hold (armed again once he is REARM back inside it) is a yank:
//         the rubber hands back YANK_E of his speed into the line, capped, and the yank's
//         strength 0..1 is that speed against YANK_HARD. A lean barely tugs, a walk is a
//         check, a swim burst / a fall / a sleeper's blow is a hard jerk. game.js reads
//         `leash.yank` the frame it fires and staggers the body (diver.js diverYank),
//         takes his hands off the controls (player.stagger), kicks the lens and sounds it.
// AIR: the supply is cut only while he STRAINS — presses outward against the hold —
// eased both ways on survival.strain (survival.js). A taut line on its own costs nothing.
// Every interaction that can throw him into the line (Orune's drag, a sleeper's shove,
// the Brooder's hammer, the bottle) works through player.vel, so all of them yank.
// ---------------------------------------------------------------------------
const GIVE = 5;                  // u of elastic give at the end of the line
const GIVE_K = 3.0;              // u/s^2 pull-back at full stretch (s^2 ramp), off the bottom
const GIVE_D = 1.6;              // 1/s outward-speed drag at full stretch (s^2 ramp), on the ground
const GIVE_DRAW = 0.5;           // u/s: the most the stretched line draws a free swimmer back
const YANK_E = 0.4;              // the rubber's restitution at the snap, on his boots
const YANK_BACK = 6;             // u/s cap on what the snap hands back, on his boots
// Off the bottom the same snap hands back far less: with nothing under him the jerk goes
// into turning him over (the tumble), and the heavy-swim carry would otherwise take a
// 3 u/s rebound ~25 u back toward the raft (measured) — a line that throws, not one that holds.
const YANK_E_SWIM = 0.22, YANK_BACK_SWIM = 2.4;
const TUMBLE_TAKE = 0.5;         // share of his along-the-arc way a full snap turns into the tumble
const YANK_HARD = 7;             // u/s into the line that makes a full-strength yank
const YANK_MIN = 0.01;           // u/s below which an arrival is only held (a lean still tugs)
const REARM = 0.75;              // u back inside the end before another snap can fire
// u/s^2 of push into the hold that counts as straining. Off the bottom it must clear the
// current and the settle (~0.6) that lean a passive man on the line; on the ground a man
// who is not pushing has nothing outward left after the boots' friction, and the push
// of a walk held at the end can freeze at the stride's lurch trough (~0.75-1.5), so the
// bar sits under that.
const PRESS_ON = 1.5, PRESS_ON_GROUND = 0.5;
const STRAIN_UP = 0.35, STRAIN_DOWN = 0.8;   // s: the air pinches off, then eases back
const END_TOL = 0.1;             // u: how close to full stretch counts as 'at the end' for strain
let heldPrev = false;            // the hold took all his outward way last frame
export const leash = {
  state: 'slack',                // 'slack' | 'give' | 'hold'
  r: 0, give: 0,                 // range from the pump, fraction into the give band
  vr: 0,                         // his radial speed this frame (+ = away from the raft)
  press: 0,                      // smoothed u/s^2 of push into the hold
  armed: true,
  yank: 0,                       // strength of a yank fired THIS frame, else 0 (game.js reads it)
  dx: 0, dy: 0, dz: 0,           // unit pull direction (toward the raft) at that yank
  n: 0,                          // yanks since load
  last: { str: 0, v: 0, back: 0, grounded: false, t: 0 },
  maxIn: 0,                      // largest integration step past L (resolved the same frame)
  maxEnd: 0                      // largest END-OF-FRAME distance past L: the hold's invariant
};
// twang: a render-only pulse that runs up the line from Sal's end after a snap
let twA = 0, twT = 9, twPhi = 0;
const TW_LEN = 0.9, TW_C = 26, TW_LAMBDA = 5.5, TW_DECAY = 22;
const rpx = new Float64Array(N), rpy = new Float64Array(N), rpz = new Float64Array(N);
// THE LEASH'S ANCHOR is the pump eased over ~1.5 s, not the live pump. The hose head
// rides the raft's heave, pitch and roll on a lever and moves 1.5-2.5 u/s radially even
// in a calm (measured), reversing several times a second; held to the live point, a man
// at full stretch was tugged back and forth by every wave — jitter at the limit, and a
// snap whose strength was half swell noise. A real line soaks that up in its own stretch
// and the tender's hands. The drawn hose still pins to the live pump.
const lan = V3(); let anPrimed = false;
const AN_TAU = 1.5;

function leashStep(dt, player) {
  leash.yank = 0;
  const L = survival.hose;
  if (!anPrimed) { lan.copy(anchor); anPrimed = true; }
  else lan.lerp(anchor, Math.min(1, dt / AN_TAU));
  const dx = player.pos.x - lan.x, dy = player.pos.y - lan.y, dz = player.pos.z - lan.z;
  const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
  leash.r = r;
  const off = window.__noLeash || player.onLadder || player.onDeck || r < 1e-6 || dt <= 0;
  if (off) {
    leash.state = 'slack'; leash.give = 0; leash.vr = 0;
    leash.press = 0; leash.armed = true; anPrimed = false; heldPrev = false;
    survival.strain = Math.max(0, survival.strain - dt / STRAIN_DOWN);
    return r;
  }
  const ux = dx / r, uy = dy / r, uz = dz / r;
  // On the ground the floor carries his weight, so the line's work is horizontal: its pull
  // and his push are read along the horizontal bearing, and the snap throws him along it.
  // hl: how much of the line's pull is horizontal. Near the raft the hose comes down
  // steeply and taking up its slack mostly LIFTS him, so his speed into the line — the
  // rate the range actually closes, which is what the snap scales on — is the
  // horizontal speed times hl.
  const grounded = !!player.grounded;
  let nx = ux, ny = uy, nz = uz, hl = 1;
  if (grounded) {
    hl = Math.hypot(ux, uz);
    if (hl > 1e-4) { nx = ux / hl; ny = 0; nz = uz / hl; } else { nx = 0; ny = 0; nz = 0; }
  }
  if (r < L - REARM) leash.armed = true;
  const g0 = L - GIVE;
  const s = r > g0 ? Math.min(1, (r - g0) / GIVE) : 0;
  leash.give = s;
  let vr = player.vel.x * nx + player.vel.y * ny + player.vel.z * nz;
  const vr0 = vr;                // his outward way as he arrives this frame, before the line
  // GIVE
  if (s > 0) {
    // (off the bottom the spring never draws him in faster than GIVE_DRAW: undamped, it
    // slingshot him back toward the raft at 3+ u/s after a snap — measured)
    const a = grounded ? Math.max(0, vr) * Math.min(1, GIVE_D * s * s * hl * dt)
      : Math.min(GIVE_K * s * s * dt, Math.max(0, vr + GIVE_DRAW));
    player.vel.x -= nx * a; player.vel.y -= ny * a; player.vel.z -= nz * a;
    vr -= a;
  }
  leash.vr = vr * hl;
  // HOLD + SNAP
  let state = s > 0 ? 'give' : 'slack';
  if (r >= L) {
    state = 'hold';
    const over = r - L;
    if (over > leash.maxIn) leash.maxIn = over;
    let back = 0;
    if (leash.armed) {
      leash.armed = false;
      const vin = Math.max(0, vr) * hl;
      if (vin > YANK_MIN) {
        const str = Math.pow(Math.min(1, vin / YANK_HARD), 0.8);
        back = grounded ? Math.min(YANK_E * vin, YANK_BACK) : Math.min(YANK_E_SWIM * vin, YANK_BACK_SWIM);
        leash.yank = str; leash.n++;
        leash.dx = -nx; leash.dy = -ny; leash.dz = -nz;
        const Ls = leash.last;
        Ls.str = str; Ls.v = vin; Ls.back = back; Ls.grounded = grounded; Ls.t = clockT;
        // the line comes up bar-straight and rings: a pulse runs up it from his end
        twA = 0.05 + 0.32 * str; twT = 0; twPhi = (leash.n * 2.3999) % (Math.PI * 2);
      }
    }
    // the travel past the end, resolved at the time of impact: reflected by what the
    // snap hands back (a hold reflects none of it), never more than half a unit
    const rr = L - Math.min(over * (back > 0 ? (grounded ? YANK_E : YANK_E_SWIM) : 0), 0.5);
    player.pos.x = lan.x + ux * rr; player.pos.y = lan.y + uy * rr; player.pos.z = lan.z + uz * rr;
    if (vr > 0) { player.vel.x -= nx * vr; player.vel.y -= ny * vr; player.vel.z -= nz * vr; }
    if (back > 0) {
      // Off the bottom, the jerk on the bonnet throws him broadside: a share of the way he
      // had ALONG the line's arc goes into the tumble, or a hard snap would hand the whole
      // of it on as a pendulum swing up toward the surface (measured 25-40 u).
      if (!grounded) {
        const k = 1 - TUMBLE_TAKE * leash.yank;
        const vt = player.vel.x * ux + player.vel.y * uy + player.vel.z * uz;
        player.vel.x = ux * vt + (player.vel.x - ux * vt) * k;
        player.vel.y = uy * vt + (player.vel.y - uy * vt) * k;
        player.vel.z = uz * vt + (player.vel.z - uz * vt) * k;
      }
      player.vel.x -= nx * back; player.vel.y -= ny * back; player.vel.z -= nz * back;
    }
    const end = Math.hypot(player.pos.x - lan.x, player.pos.y - lan.y, player.pos.z - lan.z) - L;
    if (end > leash.maxEnd) leash.maxEnd = end;
    leash.r = L + end;
  }
  leash.state = state;
  // STRAIN: how hard he is pushing into the line at the end of it, u/s^2, smoothed ~0.12 s.
  // Read as the outward way he brings into a frame AFTER a frame in which the hold took it
  // all — exactly one frame of his own drive — and 'at the end' with a hair of tolerance:
  // the eased anchor creeps, so a man pressing on the hold sits millimetres either side of
  // it. Arriving (not yet held) counts nothing: the line coming taut costs no air.
  const atEnd = r >= L - END_TOL;
  const pressNow = atEnd && heldPrev && leash.yank === 0 ? Math.max(0, vr0) / dt : 0;
  heldPrev = state === 'hold' || (heldPrev && atEnd);
  leash.press += (pressNow - leash.press) * Math.min(1, dt / 0.12);
  if (atEnd && leash.press > (grounded ? PRESS_ON_GROUND : PRESS_ON)) survival.strain = Math.min(1, survival.strain + dt / STRAIN_UP);
  else survival.strain = Math.max(0, survival.strain - dt / STRAIN_DOWN);
  return Math.min(r, L);
}

// Render positions: the physics nodes plus the snap's twang, a transverse pulse that
// leaves Sal's end (pinned: the inlet does not move) and runs up the line at TW_C u/s,
// dying over TW_LEN. Render-only — the inextensible solver has no room to ring a taut
// line, and the camera only ever sees the first twenty-odd units of it anyway.
function fillRender(dt) {
  twT += dt;
  const live = twT < TW_LEN && twA > 0;
  if (!live) {
    for (let i = 0; i < N; i++) { rpx[i] = px[i]; rpy[i] = py[i]; rpz[i] = pz[i]; }
    return;
  }
  // a frame perpendicular to the line at Sal's end; the pulse swings in a plane picked
  // per snap so two yanks do not ring identically
  let lx = px[0] - px[N - 1], ly = py[0] - py[N - 1], lz = pz[0] - pz[N - 1];
  const ll = Math.hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; lz /= ll;
  let ax = lz, ay = 0, az = -lx;                      // line x up
  const al = Math.hypot(ax, az);
  if (al < 1e-3) { ax = 1; az = 0; } else { ax /= al; az /= al; }
  const bx = ly * az - lz * ay, by = lz * ax - lx * az, bz = lx * ay - ly * ax;   // line x a
  const c = Math.cos(twPhi), sn = Math.sin(twPhi);
  const ex = ax * c + bx * sn, ey = ay * c + by * sn, ez = az * c + bz * sn;
  const env = twA * Math.exp(-twT * 4.2) * (1 - twT / TW_LEN);
  const k = 2 * Math.PI / TW_LAMBDA, front = TW_C * twT;
  const top = cum[N - 1];
  for (let i = 0; i < N; i++) {
    const d = top - cum[i];                           // arc from Sal's end
    // a wave packet centred on the front (no hard leading edge to read as a kink),
    // pinned at the inlet, fading as it runs up the line
    const q = (d - front) / TW_LAMBDA;
    const a = q > -2.5 && q < 2.5
      ? env * Math.sin(k * (d - front)) * Math.exp(-q * q * 1.4) * (1 - Math.exp(-d / 0.9)) * Math.exp(-d / TW_DECAY)
      : 0;
    rpx[i] = px[i] + ex * a; rpy[i] = py[i] + ey * a; rpz[i] = pz[i] + ez * a;
  }
}

// Returns the distance from the raft, after applying the leash to player.pos/vel.
export function updateTether(dt, player, zone) {
  // The raft rides the swell, so the anchor must track the pump's live position or the
  // hose visibly detaches from the reel by the height of a wave.
  anchor.copy(pumpPos);
  const zi = zone < 0 ? 0 : zone;
  const helmet = airInletWorldPos(_inlet);
  clockT += dt;
  // The floor cache is keyed on position only, so a zone change has to drop all of it.
  if (zi !== lastZi) { flOK.fill(0); lastZi = zi; }

  // THE LEASH: give, hold, snap (leashStep). window.__noLeash disables it so test
  // harnesses can teleport freely.
  const dist = leashStep(dt, player);
  survival.tautness = clamp(dist / survival.hose, 0, 1);

  // Tender. Pay-out is instant and unconditional; only the haul-back is rate limited,
  // which is what leaves a slack bight behind Sal when he walks home. At the very end of
  // the line `deployed` clamps to survival.hose and the hose goes honestly bar-taut —
  // that is the same moment the HUD turns red, so straight is the correct read there.
  const want = Math.min(survival.hose, dist * (1 + SLACK) + SLACK_MIN);
  if (deployed < want) deployed = want;
  else deployed = Math.max(want, deployed - RETRIEVE * dt);
  // EXCESS_MAX is the accordion fix. A buoyant ascent closes range at up to ~9 u/s
  // against a 0.6 u/s haul, so rising off the zone-0 floor used to strand ~200 units of
  // excess line that the solver folded into a zigzag around the diver (user-reported,
  // twice). A real tender takes up line AS FAST AS THE DIVER RISES; the slow RETRIEVE
  // is only for slack that has already formed. Capping the excess never lets the new
  // slack form: the per-frame delta this clamp removes is bounded by the player's own
  // speed, so the rope is never yanked, and the walk-home bight survives at up to 8
  // units, which allocRest still parks at Sal's shoulder.
  deployed = Math.min(deployed, want + EXCESS_MAX);
  deployed = Math.min(deployed, survival.hose);
  if (restFor < 0 || Math.abs(deployed - restFor) > restFor * 0.005) {
    allocRest(deployed, dist); restFor = deployed;
  }

  if (!primed) { _pa.copy(anchor); _ph.copy(helmet); primed = true; }
  raftOn = deckOn && !!raft.parent;
  if (raftOn) _rInv.copy(raft.matrixWorld).invert();
  updateCurrent(clockT);

  // dt is split into equal steps that always consume the whole frame, so the rope never
  // runs slow at low frame rates (a fixed 60 Hz step with a substep cap starves it while
  // the pinned ends keep teleporting at the real rate — which straightens the rope).
  // A zero-length frame (two frames inside one clock tick: the driven probe loop does
  // it) used to integrate with h = 0 and divide by it in substep's velocity recovery —
  // 0 * Infinity — poisoning every node with NaN for the rest of the session (the hose
  // vanished; caught while verifying the leash). No time, no step.
  const step = Math.min(dt, 0.1);
  const nsub = step > 0 ? Math.min(MAXSUB, Math.max(1, Math.ceil(step / FIXED))) : 0;
  const h = nsub > 0 ? step / nsub : 0;
  for (let s = 1; s <= nsub; s++) {
    const u = s / nsub;          // lerp the pinned ends across substeps or a fast diver jolts them
    substep(h,
      _pa.x + (anchor.x - _pa.x) * u, _pa.y + (anchor.y - _pa.y) * u, _pa.z + (anchor.z - _pa.z) * u,
      _ph.x + (helmet.x - _ph.x) * u, _ph.y + (helmet.y - _ph.y) * u, _ph.z + (helmet.z - _ph.z) * u,
      zi);
  }
  _pa.copy(anchor); _ph.copy(helmet);

  // One cylinder per segment, stretched EXT past each end so the wedge gap that real
  // bending now opens at every joint stays buried inside the joint. Drawn from the
  // render positions (physics + the snap's twang).
  fillRender(dt);
  let arc = 0;
  for (let c = 0; c < CHUNKS; c++) {
    const inst = meshes[c], att = arcAttr[c];
    for (let j = 0; j < SEG; j++) {
      const i = c * SEG + j;
      _p.set(rpx[i], rpy[i], rpz[i]);
      _d.set(rpx[i + 1] - rpx[i], rpy[i + 1] - rpy[i], rpz[i + 1] - rpz[i]);
      const len = _d.length() || 1e-6;
      _d.divideScalar(len);
      _q.setFromUnitVectors(_up, _d);
      _s.set(RAD, len + 2 * EXT, RAD);
      _m.compose(_p.addScaledVector(_d, -EXT), _q, _s);
      inst.setMatrixAt(j, _m);
      att[j] = arc - EXT;        // world arc at the instance's local y = 0
      arc += len;
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.geometry.attributes.aArc.needsUpdate = true;
  }
  // the brass at the raft end, seated on node 0 along the first segment
  _d.set(px[1] - px[0], py[1] - py[0], pz[1] - pz[0]).normalize();
  _q.setFromUnitVectors(_up, _d);
  // (seated 0.22 m down the line: node 0 is inside the davit sheave, which hid it)
  ferrule.matrix.compose(_p.set(px[0], py[0], pz[0]).addScaledVector(_d, FERRULE_AT), _q, _one);
  ferrule.matrixWorldNeedsUpdate = true;
  return dist;
}

// Dev surface: shape metrics without having to unpack instanceMatrix from the console.
if (typeof window !== 'undefined') {
  // THE LEASH probe: live state, the last yank, and the hold's invariants. reset() clears
  // the maxima before a run.
  window.__leash = leash;
  leash.reset = () => { leash.maxIn = 0; leash.maxEnd = 0; leash.n = 0; leash.last.str = 0; leash.last.v = 0; };
  Object.defineProperty(leash, 'clock', { get: () => clockT });   // sim seconds (sum of dt)
  leash.k = { GIVE, GIVE_K, GIVE_D, GIVE_DRAW, YANK_E, YANK_BACK, YANK_HARD, YANK_MIN, REARM, PRESS_ON, PRESS_ON_GROUND };
  window.tether = {
    get deployed() { return deployed; },
    get contacts() { return contacts; },
    get deckContacts() { return deckContacts; },
    get deck() { return deckOn; },
    set deck(v) { deckOn = !!v; },
    // Mirrors the vertex shader exactly, so the screen-width floor can be read rather
    // than inferred. widthPx is what the hose actually covers at that view depth.
    get pix() { return uPix.value; },
    get minPx() { return uMinPx.value; },
    set minPx(v) { uMinPx.value = v; },   // 0 restores the pre-widening hose for an A/B
    kAt(dv) { return Math.max(1, uMinPx.value * Math.max(dv, 0.5) / uPix.value / (2 * RAD)); },
    widthPx(dv) { return 2 * RAD * this.kAt(dv) * uPix.value / Math.max(dv, 1e-6); },
    nodes: () => ({ px, py, pz, N }),
    stats() {
      let len = 0, sum = 0, max = 0;
      for (let i = 0; i < M; i++) len += Math.hypot(px[i + 1] - px[i], py[i + 1] - py[i], pz[i + 1] - pz[i]);
      for (let i = 1; i < N - 1; i++) {
        const ax = px[i] - px[i - 1], ay = py[i] - py[i - 1], az = pz[i] - pz[i - 1];
        const bx = px[i + 1] - px[i], by = py[i + 1] - py[i], bz = pz[i + 1] - pz[i];
        const al = Math.hypot(ax, ay, az) || 1e-9, bl = Math.hypot(bx, by, bz) || 1e-9;
        const a = Math.acos(clamp((ax * bx + ay * by + az * bz) / (al * bl), -1, 1)) * 180 / Math.PI;
        sum += a; if (a > max) max = a;
      }
      const cx = px[N - 1] - px[0], cy = py[N - 1] - py[0], cz = pz[N - 1] - pz[0];
      const cl = Math.hypot(cx, cy, cz) || 1e-9;
      let dev = 0;
      for (let i = 1; i < N - 1; i++) {
        const rx = px[i] - px[0], ry = py[i] - py[0], rz = pz[i] - pz[0];
        const t = (rx * cx + ry * cy + rz * cz) / (cl * cl);
        dev = Math.max(dev, Math.hypot(rx - cx * t, ry - cy * t, rz - cz * t));
      }
      return { dist: cl, polyLen: len, deployed, excess: len / deployed - 1, meanBend: sum / (N - 2), maxBend: max, bow: dev, contacts, segFirst: rest[M - 1], segLast: rest[0] };
    }
  };
}
