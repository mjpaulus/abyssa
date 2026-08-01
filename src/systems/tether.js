// The umbilical: a heavy rubber-and-canvas air hose from the raft's pump to Sal's helmet.
// Also enforces the hard leash — the diver physically cannot outrun his air supply.
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
import { scene, envTex } from '../core.js';
import { V3, clamp, fbm } from '../lib/math.js';
import { terrainH } from '../world/terrain.js';
import { survival } from './survival.js';
import { pumpPos } from './raft.js';
import { airInletWorldPos } from '../entities/diver.js';

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
const SEG_FINE = 0.40;           // rest length of the segment at Sal's shoulder
const FINE = 40;                 // segments that absorb an un-retrieved bight
const BIGHT = 0.5;               // fraction of the slack parked at the diver's end
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
let contacts = 0;

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

  const inv = 1 / h;
  for (let i = 1; i < N - 1; i++) {
    vx[i] = (px[i] - ox[i]) * inv; vy[i] = (py[i] - oy[i]) * inv; vz[i] = (pz[i] - oz[i]) * inv;
  }
}

// ---------------------------------------------------------------------------
// Material: wet rubber and tarred canvas. The rib is driven from world arc length in the
// shader, NOT from the segment index — segment length runs 0.4 m to 24 m depending on how
// far Sal is from the raft, so an index-driven rib made the hose's apparent texture a
// function of his depth. No azimuthal term: the instance frame is a shortest-arc rotation
// whose roll is undetermined for near-vertical segments and re-randomises every frame, so
// any helix would swim. Rings only.
// ---------------------------------------------------------------------------
function tetherMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x33383b, roughness: 0.5, metalness: 0.0,
    envMap: envTex, envMapIntensity: 0.25
  });
  mat.customProgramCacheKey = () => 'abyssa-tether';   // three silently shares programs otherwise
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPix = uPix;
    sh.uniforms.uMinPx = uMinPx;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aArc;
        varying float vArc;
        varying vec3 vAxisView;
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
        #include <project_vertex>`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vArc;
        varying vec3 vAxisView;
        float ribAt(float a) { return sin(6.2831853 * a / ${RIB_PITCH.toFixed(4)}); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float rib = ribAt(vArc);
        // Slow drift toward tarred canvas over the rubber, on a metre scale. These are
        // LINEAR values, not sRGB: three converts the diffuse uniform for you but not a
        // literal written here, and an sRGB literal lands about 7x too bright.
        float tar = 0.5 + 0.5 * sin(vArc * 0.37) * sin(vArc * 0.11 + 1.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.062, 0.049, 0.036), tar * 0.55);
        diffuseColor.rgb *= 0.86 + 0.14 * rib;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= mix(1.24, 0.84, 0.5 + 0.5 * rib);`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize(normal + vAxisView * rib * 0.42);`);
  };
  return mat;
}

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
}

export function tetherAnchor() { return anchor; }

export function setTetherVisible(v) { for (const m of meshes) m.visible = v; }

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

  // Hard leash: the hose runs out and the diver is held back.
  // window.__noLeash disables it so test harnesses can teleport freely.
  const toDiver = _d.copy(player.pos).sub(anchor);
  const dist = toDiver.length();
  if (dist > survival.hose && !window.__noLeash) {
    toDiver.multiplyScalar(survival.hose / dist);
    player.pos.copy(anchor).add(toDiver);
    const outward = player.vel.dot(toDiver.normalize());
    if (outward > 0) player.vel.addScaledVector(toDiver, -outward);
  }
  survival.tautness = clamp(dist / survival.hose, 0, 1);

  // Tender. Pay-out is instant and unconditional; only the haul-back is rate limited,
  // which is what leaves a slack bight behind Sal when he walks home. At the very end of
  // the line `deployed` clamps to survival.hose and the hose goes honestly bar-taut —
  // that is the same moment the HUD turns red, so straight is the correct read there.
  const want = Math.min(survival.hose, dist * (1 + SLACK) + SLACK_MIN);
  if (deployed < want) deployed = want;
  else deployed = Math.max(want, deployed - RETRIEVE * dt);
  deployed = Math.min(deployed, survival.hose);
  if (restFor < 0 || Math.abs(deployed - restFor) > restFor * 0.005) {
    allocRest(deployed, dist); restFor = deployed;
  }

  if (!primed) { _pa.copy(anchor); _ph.copy(helmet); primed = true; }
  updateCurrent(clockT);

  // dt is split into equal steps that always consume the whole frame, so the rope never
  // runs slow at low frame rates (a fixed 60 Hz step with a substep cap starves it while
  // the pinned ends keep teleporting at the real rate — which straightens the rope).
  const step = Math.min(dt, 0.1);
  const nsub = Math.min(MAXSUB, Math.max(1, Math.ceil(step / FIXED)));
  const h = step / nsub;
  for (let s = 1; s <= nsub; s++) {
    const u = s / nsub;          // lerp the pinned ends across substeps or a fast diver jolts them
    substep(h,
      _pa.x + (anchor.x - _pa.x) * u, _pa.y + (anchor.y - _pa.y) * u, _pa.z + (anchor.z - _pa.z) * u,
      _ph.x + (helmet.x - _ph.x) * u, _ph.y + (helmet.y - _ph.y) * u, _ph.z + (helmet.z - _ph.z) * u,
      zi);
  }
  _pa.copy(anchor); _ph.copy(helmet);

  // One cylinder per segment, stretched EXT past each end so the wedge gap that real
  // bending now opens at every joint stays buried inside the joint.
  let arc = 0;
  for (let c = 0; c < CHUNKS; c++) {
    const inst = meshes[c], att = arcAttr[c];
    for (let j = 0; j < SEG; j++) {
      const i = c * SEG + j;
      _p.set(px[i], py[i], pz[i]);
      _d.set(px[i + 1] - px[i], py[i + 1] - py[i], pz[i + 1] - pz[i]);
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
  return dist;
}

// Dev surface: shape metrics without having to unpack instanceMatrix from the console.
if (typeof window !== 'undefined') {
  window.tether = {
    get deployed() { return deployed; },
    get contacts() { return contacts; },
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
