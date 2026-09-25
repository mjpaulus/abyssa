// Predators: shark (zones 0-1), octopus (floor dens, all zones), squid (zone 2).
// OWNED BY: predator agent.
//
// Contract with game.js:
//   buildPredators()            — called once at world build.
//   switchPredatorZone(zi)      — called from enterZone(zi).
//   updatePredators(dt, t, player, lanternPos) — every play frame. Returns an event
//     object (allocate once, reuse): {
//       threat: 0..1     — proximity/aggression scalar for audio dread
//       bite: 0|force    — a strike landed this frame (oxygen leak + shake + msg)
//       lightSteal: 0..1 — light being drained this frame (octopus grab / squid nibble)
//       inkPickup: 0|n   — ink sacs collected this frame (adds to survival.ink)
//       lanternStolen: bool — STATE, true every frame the octopus has the lantern:
//                        game.js holds player.light at 0 while set (octopus-lantern-theft)
//       lanternTaken / lanternReturned: bool — one-shot edges of that state
//       msg: string|null — one-shot HUD line for the theft beats (MSG_LANTERN_*)
//     }
//   slash(pos, fwd, range)      — the knife arc landed; kills a squid or spooks a hunter.
//   deployInk(pos)              — vents a carried sac as a shark-breaking cloud.
//   reseedDens()                 — call after flora rebuilds (new dive site): every
//     boulder moved, so octopus dens (picked once at build from flora's rockColliders)
//     are re-picked against the live pool. Safe to call mid-chase; fires no event.
//     Also restores every squid keeper (below) to its post for the new site's Mhor.
//
// Contract with entities/leviathan.js (eval-zone-tool-reasons — MHOR'S KEEPERS):
//   setWardTargets(zi, sigils)  — leviathan.js, every un-calmed zone-2 frame: the live
//     wards ({grp.position, lit}). Copied, never held. (-1, null) clears.
//   wardGuardCount(i)           — living squid keepers stationed on ward i. leviathan.js
//     refuses the touch while > 0. Keepers are ordinary shoal squid with a role: the
//     same instanced buffers, the same knife/spear kill, the same ink sac.
//
// Cost model, mirroring creatures.js: the CPU steers a handful of bodies (1 shark,
// 3 octopuses, 4 squid in the active zone) and everything expensive — spine
// undulation, eight-arm curl chains, tentacle sway, photophore strobing — lives in
// vertex/fragment shaders. Only the active zone is stepped; the rest are
// visible=false and skipped entirely. Nothing is allocated per frame.
import * as THREE from 'three';
import { scene } from '../core.js';
import { WORLD_R, zoneTop, zoneBottom } from '../config.js';
import { registerPaint, injectStrokes } from '../lib/paint.js';
import { rng, clamp, lerp, V3 } from '../lib/math.js';
import { glowTex, makeGlow } from '../lib/textures.js';
import { terrainH } from './terrain.js';
import { rockColliders } from './flora.js';
import { siteParams, stream } from './site.js';
import { SKIN_COMMON, SKIN_LIGHTS } from './fauna.js';

// CHART V2 determinism (same contract as flora/creatures): every placement/phase draw
// routes through site-seeded streams, never Math.random.
//   _pr — build-time cosmetics (octopus uSeed, squid phases, sac phases), installed
//         once per build in buildPredators().
//   _pd — den layout. Installed FRESH by both buildOctopuses() and reseedDens() (via
//         denStream()), and both paths consume it in the identical order, so a boot at
//         a site and an arrive() back to it place bit-identical dens.
let _pr = Math.random;
let _pd = Math.random;
const denStream = () => {
  const r = siteParams('predators').rng;
  return stream((Math.floor(r() * 4294967296) ^ 0xDE45) | 0);
};

// ---------------------------------------------------------------------------
// shared plumbing
// ---------------------------------------------------------------------------

const ev = { threat: 0, bite: 0, lightSteal: 0, inkPickup: 0, lanternStolen: false, lanternTaken: false, lanternReturned: false, msg: null };

// ---- THE LANTERN THEFT (octopus-lantern-theft) ------------------------------------
// Some grabs are not a grab. Once the arms are on the lantern, about one grab in three
// (a fixed draw off the grab COUNT, so the same session rolls the same way) the animal
// simply takes it: the light goes to nothing and stays there, and the octopus jets for
// its den carrying a glow. Sal gets it back by going to the den — within LANT_REACH of
// the light, on foot, no button — and the thief inks and lets go. Left 90 s it tires of
// the thing and drops it at the den mouth, where it lies on the floor, still lit.
// The glow is a SPRITE, never a light: the scene's light count is sacred.
const LANT = { p: 0.35, snatchT: 0.9, reach: 2.5, hold: 90 };
export const MSG_LANTERN_TAKEN = 'IT HAS YOUR LANTERN. IT IS MAKING FOR ITS DEN.';
export const MSG_LANTERN_BACK = 'THE LANTERN. IT LET GO.';
export const MSG_LANTERN_DROPPED = 'IT TIRED OF THE LIGHT. THE LANTERN LIES AT THE DEN MOUTH.';
const lantern = {
  stolen: false, by: null, carried: false, pos: V3(), t: 0, grabs: 0,
  glow: null, core: null, pendingReturn: false, pendingMsg: null
};
// The roll, off the grab count alone.
function theftRoll(n) { return stream((0xA5C7 + n * 7919) | 0)() < LANT.p; }

const uTime = { value: 0 };
const uFogD = { value: 0.016 };

const TAU = Math.PI * 2;
// Sight wall. 205 was zone 0's green 2% visibility under the OLD uniform water; the
// column is stratified since THE SILT LINE and the real wall reaches ~380-480 out of
// the silt. Mirror creatures.js's computation off scene.fog.density (updated every
// frame in updatePredators) so predators stop popping at half the visible range.
const CULL_MAX = 420;                   // above any reachable clear-band sightline
let CULL = 205;

// hot-path temps — module-owned, never allocated per frame
const _a = V3(), _b = V3(), _c = V3(), _d = V3(), _lp = V3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _sc = V3(1, 1, 1);
// combat temps — slash/deployInk/pickups run outside the steering loops, but keeping
// them separate means a future reorder can never alias the hot-path scratch above.
const _k1 = V3(), _k2 = V3(), _k3 = V3();
const UP = V3(0, 1, 0);

// Additive/alpha billboards must fade to black with distance rather than toward the
// fog colour — same trick creatures.js uses for its glow fields.
const FOG_GLSL = `
uniform float uFogD;
float fogVis(vec3 wp){ float d = length(wp - cameraPosition); return exp(-uFogD*uFogD*d*d); }`;
const TONE_OUT = '#include <tonemapping_fragment>\n#include <colorspace_fragment>';

function zoneMidY(zi) { return (zoneTop(zi) + zoneBottom(zi)) * 0.5; }

// Turn `fwd` toward `want` by at most `rate` radians, keeping it unit length. This is
// what makes every predator arc rather than snap — the whole read of a hunter.
function steer(fwd, want, rate, dt) {
  const wl = want.length();
  if (wl < 1e-5) return;
  want.divideScalar(wl);
  const dot = clamp(fwd.dot(want), -1, 1);
  const ang = Math.acos(dot);
  if (ang < 1e-4) { fwd.copy(want); return; }
  const step = Math.min(ang, rate * dt);
  // rotate fwd toward want about their common perpendicular
  _d.crossVectors(fwd, want);
  if (_d.lengthSq() < 1e-8) _d.set(0, 1, 0); else _d.normalize();
  _q.setFromAxisAngle(_d, step);
  fwd.applyQuaternion(_q).normalize();
}

// Billboarded quad field, shared shape for ink puffs and squid photophores.
function billboardField(n, mat) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(quad.index);
  g.setAttribute('position', quad.attributes.position);
  g.setAttribute('uv', quad.attributes.uv);
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
  g.instanceCount = n;
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  quad.dispose();
  return m;
}

function billboardMaterial(blending, alphaExpr) {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: glowTex }, uFogD },
    vertexShader: `
      attribute vec3 aPos; attribute float aSize; attribute vec4 aCol;
      varying vec2 vUv; varying vec4 vC; varying float vFog;
      ${FOG_GLSL}
      void main(){
        vFog = fogVis(aPos);
        vec4 mv = viewMatrix * vec4(aPos, 1.0);
        mv.xy += position.xy * aSize;
        gl_Position = projectionMatrix * mv;
        vUv = uv; vC = aCol;
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      varying vec2 vUv; varying vec4 vC; varying float vFog;
      void main(){
        float a = texture2D(uMap, vUv).a;
        ${alphaExpr}
        ${TONE_OUT}
      }`,
    transparent: true, depthWrite: false, blending
  });
}

// ---------------------------------------------------------------------------
// SHARK — geometry
// ---------------------------------------------------------------------------

// Radius profile, keyed by hand: blunt-conical snout, thickest just behind the first
// dorsal, then a long taper into a narrow peduncle. Interpolated with smoothstep so
// the silhouette has no visible facets at 40u.
const SHARK_R = [
  [0.000, 0.020], [0.040, 0.130], [0.100, 0.265], [0.175, 0.385],
  [0.280, 0.455], [0.380, 0.470], [0.500, 0.442], [0.640, 0.338],
  [0.780, 0.212], [0.890, 0.120], [1.000, 0.062]
];

// polish-fauna: Catmull-Rom through the keys. The old per-segment smoothstep put a
// flat spot at every key, invisible at 26 rings and a row of lumps at 110.
function sharkR(t) {
  const K = SHARK_R, n = K.length;
  for (let i = 1; i < n; i++) {
    if (t <= K[i][0]) {
      const p0 = K[Math.max(0, i - 2)][1], p1 = K[i - 1][1], p2 = K[i][1], p3 = K[Math.min(n - 1, i + 1)][1];
      const u = (t - K[i - 1][0]) / (K[i][0] - K[i - 1][0]);
      return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
    }
  }
  return K[n - 1][1];
}

// Body runs along +Z, snout at z=+0.5. uv.x = 0 snout .. 1 peduncle (and past 1 on the
// caudal fin, so the shader whips it harder); uv.y = 0 belly, 1 dorsal ridge, 2.0 flags
// fin geometry. Same convention as creatures.js fish, so the shading code rhymes.
// A vertex that only ever sits in collapsed triangles (a fin's tip row, a knife edge)
// gets a zero normal from computeVertexNormals, and normalize(0) is NaN on the GPU —
// one NaN pixel and the bloom/exposure chain blacks out the whole frame. Give any such
// vertex a finite normal.
function safeNormals(g) {
  const n = g.attributes.normal.array;
  for (let i = 0; i < n.length; i += 3) if (n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2] < 1e-12) { n[i] = 0; n[i + 1] = 1; n[i + 2] = 0; }
}

function sharkGeometry() {
  const SIDES = 36;
  const pos = [], uv = [], idx = [], surf = [];
  // Fineness ratio matters more than any other number here: a pelagic shark is about
  // 5.5 body lengths long for its depth. Anything fatter reads as a tuna.
  const W = 0.158, H = 0.205;           // sharks are taller than wide
  // polish-fauna: rings are spent where the detail is. The head (eye, mouth) and the
  // gill field get fine rings, the long flank coarse ones; ~4.7k tris the lot.
  const T = [];
  for (let t = 0; t < 0.13; t += 0.0065) T.push(t);
  for (let t = 0.13; t < 0.31; t += 0.0032) T.push(t);
  for (let t = 0.31; t < 1.0; t += 0.0135) T.push(t);
  T.push(1.0);
  const RINGS = T.length - 1, cols = SIDES + 1;
  // Five gill slits, the last two shorter, each a real groove: the cut dips into the
  // flank and the flap behind it stands proud, so the slit has an edge light catches.
  const GILL_T = [0.186, 0.207, 0.228, 0.249, 0.268], GILL_H = [1, 1, 0.95, 0.85, 0.72];
  const gill = (t, s) => {
    let d = 0;
    for (let k = 0; k < 5; k++) {
      const lo = -0.34 * GILL_H[k] - 0.05, hi = 0.46 * GILL_H[k];
      if (s < lo || s > hi) continue;
      const along = (s - lo) / (hi - lo);
      const len = Math.sin(Math.PI * along) ** 0.5;
      const dt = t - GILL_T[k] - 0.006 * (s - 0.1);      // slits rake back toward the belly
      const cut = Math.exp(-(((dt / 0.0022)) ** 2));
      const flap = Math.exp(-((((dt - 0.0055) / 0.003)) ** 2));
      d += (-0.075 * cut + 0.018 * flap) * len;
    }
    return d;
  };
  // Underslung crescent mouth: a groove whose corners sweep back along the jaw line.
  const MOUTH = c => 0.066 + 0.042 * c * c;
  const mouth = (t, s, c) => {
    if (s > -0.25 || Math.abs(c) > 0.9) return 0;
    const k = (1 - Math.abs(c) / 0.9) ** 0.6 * Math.min(1, (-s - 0.25) / 0.3);
    const dt = t - MOUTH(c);
    return -0.09 * Math.exp(-(((dt / 0.0065)) ** 2)) * k;
  };
  // A proud, wet eye in a shallow orbit.
  const EYE_T = 0.092, EYE_S = 0.34;
  const eye = (t, s) => {
    const d = Math.hypot((t - EYE_T) / 0.012, (s - EYE_S) / 0.11);
    return d < 1 ? 0.028 * Math.sqrt(1 - d * d) : (d < 1.6 ? -0.010 * Math.sin((d - 1) / 0.6 * Math.PI) : 0);
  };
  const bodyAt = (t, ang, out) => {
    const r = sharkR(t), s = Math.sin(ang), c = Math.cos(ang);
    const flat = s < 0 ? 0.86 : 1.0;
    const headSquash = 1 - 0.22 * Math.max(0, 1 - t * 6) * Math.max(0, s);
    const snout = Math.max(0, 1 - t * 5);
    const headWide = 1 + 0.28 * snout;
    const headFlat = 1 - 0.14 * snout;
    const k = 1 + gill(t, s) + mouth(t, s, c) + eye(t, s);
    out[0] = c * r * W * headWide * k; out[1] = s * r * H * flat * headSquash * headFlat * k; out[2] = 0.5 - t;
    return out;
  };
  const bp = [0, 0, 0];
  for (let i = 0; i <= RINGS; i++) {
    const t = T[i];
    for (let j = 0; j <= SIDES; j++) {
      const ang = j / SIDES * TAU;
      bodyAt(t, ang, bp);
      pos.push(bp[0], bp[1], bp[2]);
      uv.push(t, 0.5 + 0.5 * Math.sin(ang));
      surf.push(t, j / SIDES, 0);
    }
  }
  for (let i = 0; i < RINGS; i++) for (let j = 0; j < SIDES; j++) {
    const a = i * cols + j, b = a + 1;
    idx.push(a, a + cols, b, b, a + cols, b + cols);
  }

  const fin = (verts, tris, flag = 2.0) => {
    const base = pos.length / 3;
    for (const v of verts) { pos.push(v[0], v[1], v[2]); uv.push(v[3], flag); surf.push(v[3], 0, 1); }
    for (const tri of tris) idx.push(base + tri[0], base + tri[1], base + tri[2]);
  };
  // A fin with a body: convex leading edge, falcate (concave) trailing edge, and a
  // thickness that swells behind the leading edge and dies to a knife at the rim.
  // a = leading root, b = trailing root, tip. uv.x is the body t (0.5 - z) so the
  // undulation bends every fin exactly as it bent the old flat triangles.
  const _l = [0, 0, 0], _t = [0, 0, 0];
  const bez = (p0, p1, p2, u, o) => { const w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u; for (let k = 0; k < 3; k++) o[k] = p0[k] * w0 + p1[k] * w1 + p2[k] * w2; return o; };
  const finSolid = (a, b, tip, th, o = {}) => {
    const NS = o.ns || 7, NC = o.nc || 6;
    const e1 = [tip[0] - a[0], tip[1] - a[1], tip[2] - a[2]], e2 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nl = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map(v => v / nl);
    const fwd = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cl = [0, 1, 2].map(k => a[k] + (tip[k] - a[k]) * 0.5 + fwd[k] * (o.lead ?? 0.22));
    const ct = [0, 1, 2].map(k => b[k] + (tip[k] - b[k]) * 0.55 + fwd[k] * (o.fal ?? 0.3));
    const base = pos.length / 3, per = NC + 1;
    for (const side of [1, -1]) {
      for (let i = 0; i <= NS; i++) {
        const v = i / NS;
        bez(a, cl, tip, v, _l); bez(b, ct, tip, v, _t);
        for (let j = 0; j <= NC; j++) {
          const u = j / NC;
          const thk = th * (1 - 0.85 * v) * 2.6 * Math.sqrt(u) * (1 - u) * side;
          const x = _l[0] + (_t[0] - _l[0]) * u + n[0] * thk, y = _l[1] + (_t[1] - _l[1]) * u + n[1] * thk, z = _l[2] + (_t[2] - _l[2]) * u + n[2] * thk;
          pos.push(x, y, z); uv.push(0.5 - z, 2.0); surf.push(v, u, 1);
        }
      }
    }
    const off = (NS + 1) * per;
    for (let i = 0; i < NS; i++) for (let j = 0; j < NC; j++) {
      const p = base + i * per + j;
      idx.push(p, p + per, p + 1, p + 1, p + per, p + per + 1);
      const q = p + off;
      idx.push(q, q + 1, q + per, q + 1, q + per + 1, q + per);
    }
  };

  // heterocercal caudal: a long swept upper lobe and a short lower lobe, deep notch
  const zT = -0.5;
  finSolid([0, 0.030, zT + 0.035], [0, -0.004, zT - 0.02], [0, 0.185, zT - 0.315], 0.010, { lead: 0.1, fal: 0.55, ns: 9 });
  finSolid([0, -0.022, zT + 0.03], [0, 0.002, zT - 0.02], [0, -0.098, zT - 0.145], 0.008, { lead: 0.1, fal: 0.35 });
  // caudal peduncle keel wedges: paired lateral wedges at t≈0.88, the hydrodynamic
  // flare every pelagic shark carries just ahead of the tail (+8 tris)
  const kr = sharkR(0.88) * W, kz0 = 0.5 - 0.845, kz1 = 0.5 - 0.915;
  for (const s of [-1, 1]) fin([
    [s * kr * 0.75, 0.006, kz0, 0.845],
    [s * kr * 0.75, -0.006, kz0, 0.845],
    [s * (kr + 0.030), 0.000, 0.5 - 0.880, 0.880],
    [s * kr * 0.62, 0.005, kz1, 0.915],
    [s * kr * 0.62, -0.005, kz1, 0.915]
  ], [[0, 2, 1], [0, 3, 2], [1, 2, 4], [3, 4, 2]]);

  // first dorsal — tall, raked back, falcate; the read at range
  const d0 = sharkR(0.36) * H, d1 = sharkR(0.55) * H;
  finSolid([0, d0 * 0.9, 0.5 - 0.35], [0, d1 * 0.9, 0.5 - 0.57], [0, d0 + 0.118, 0.5 - 0.505], 0.014, { lead: 0.2, fal: 0.34, ns: 8 });
  // second dorsal — small
  const e0 = sharkR(0.76) * H;
  finSolid([0, e0 * 0.9, 0.5 - 0.755], [0, sharkR(0.855) * H * 0.9, 0.5 - 0.86], [0, e0 + 0.034, 0.5 - 0.82], 0.006, { ns: 4, nc: 4 });
  // pectorals — long, swept, angled down; the widest thing on the animal
  const pr = sharkR(0.28) * W;
  for (const s of [-1, 1]) finSolid([s * pr * 0.88, -0.012, 0.5 - 0.232], [s * pr * 0.88, -0.03, 0.5 - 0.335], [s * (pr + 0.16), -0.088, 0.5 - 0.405], 0.012, { lead: 0.16, fal: 0.3, ns: 8 });
  // pelvics
  const vr = sharkR(0.62) * W;
  for (const s of [-1, 1]) finSolid([s * vr * 0.85, -sharkR(0.62) * H * 0.7, 0.5 - 0.60], [s * vr * 0.85, -sharkR(0.68) * H * 0.7, 0.5 - 0.68], [s * (vr + 0.05), -sharkR(0.65) * H * 0.72 - 0.042, 0.5 - 0.67], 0.006, { ns: 4, nc: 4 });
  // anal fin
  finSolid([0, -sharkR(0.80) * H * 0.8, 0.5 - 0.80], [0, -sharkR(0.875) * H * 0.8, 0.5 - 0.875], [0, -sharkR(0.83) * H * 0.82 - 0.032, 0.5 - 0.86], 0.005, { ns: 4, nc: 4 });

  // TEETH: two serrated rows along the crescent, the uppers hanging, the lowers
  // standing — white triangles seated in the mouth groove (uv.y 3 flags enamel).
  const tp0 = [0, 0, 0], tp1 = [0, 0, 0], tp2 = [0, 0, 0];
  for (const row of [-1, 1]) {
    for (let k = 0; k < 26; k++) {
      const c = -0.8 + 1.6 * (k + 0.5) / 26;
      const s = -Math.sqrt(Math.max(0, 1 - c * c));
      const ang = Math.atan2(s, c), da = 0.028;
      const tt = MOUTH(c) + row * 0.0028;
      bodyAt(tt, ang - da, tp0); bodyAt(tt, ang + da, tp1);
      bodyAt(MOUTH(c) - row * 0.0015, ang, tp2);
      // pull the tooth a hair inside the lip and point it across the gape
      const tipIn = 0.9;
      tp2[0] *= tipIn; tp2[1] *= tipIn;
      const tl = 0.5 - tt;
      fin([[tp0[0] * 0.97, tp0[1] * 0.97, tp0[2], tl], [tp1[0] * 0.97, tp1[1] * 0.97, tp1[2], tl], [tp2[0], tp2[1], tp2[2], tl]], [[0, 1, 2], [0, 2, 1]], 3.0);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSurf', new THREE.Float32BufferAttribute(surf, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld the body's seam column normals
  const nr = g.attributes.normal.array;
  for (let i = 0; i <= RINGS; i++) {
    const a = i * cols * 3, b = (i * cols + SIDES) * 3;
    for (let k = 0; k < 3; k++) { const m = (nr[a + k] + nr[b + k]) * 0.5; nr[a + k] = m; nr[b + k] = m; }
  }
  safeNormals(g);
  g.boundingSphere = new THREE.Sphere(V3(0, 0, -0.15), 1.1);
  return g;
}

// Undulation is a travelling wave whose amplitude is near zero at the skull and peaks
// at the tail — carangiform, i.e. tighter and stiffer than the leviathan's ribbon.
function sharkMaterial(cfg) {
  const u = {
    uPhase: { value: 0 }, uAmp: { value: 0.045 }, uArch: { value: 0 }, uTime,
    uDark: { value: new THREE.Color(cfg.dark) },
    uPale: { value: new THREE.Color(cfg.pale) },
    uSheen: { value: cfg.sheen },
    uScar: { value: cfg.scar || 0 }
  };
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.46, metalness: 0.16,
    side: THREE.DoubleSide, emissive: 0x000000
  });
  mat.userData.u = u;
  // Three caches compiled programs by material type + parameters, NOT by the source
  // onBeforeCompile produced. Without a distinct key the shark, octopus and squid — all
  // MeshStandardMaterial — collide and get whichever program compiled first.
  mat.customProgramCacheKey = () => 'abyssa-shark-skin';
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aSurf;
        uniform float uPhase; uniform float uAmp; uniform float uArch;
        varying vec2 vSuv; varying vec3 vSsurf; varying vec3 vAxis;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float bT = uv.x;
        float env = 0.02 + 0.98 * pow(clamp(bT, 0.0, 1.3), 2.35);
        float amp = uAmp * env;
        float slope = cos(bT*4.6 - uPhase) * amp * 4.6;
        objectNormal = normalize(vec3(objectNormal.x, objectNormal.y, objectNormal.z + slope*objectNormal.x));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.x += sin(bT*4.6 - uPhase) * amp;
        // strike arch: the whole body bows, so the turn-in reads before it happens
        transformed.x += uArch * env * 0.16;
        transformed.y += sin(uPhase*0.37) * 0.006;
        vSuv = uv; vSsurf = aSurf;
        // the body axis, bent by the same wave: the grain the denticles lie along
        vAxis = normalize((modelViewMatrix * vec4(-slope, 0.0, 1.0, 0.0)).xyz);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uDark; uniform vec3 uPale; uniform float uSheen; uniform float uScar; uniform float uTime;
        varying vec2 vSuv; varying vec3 vSsurf; varying vec3 vAxis;
        ${SKIN_COMMON}
        // distance from p to segment ab (scar strokes in t / around space)
        // distance to a healed scar stroke: tapered at both ends, the edge torn by noise
        float shSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
          float taper = 0.35 + 0.65 * sin(3.14159 * h); return length(pa - ba * h) / taper + (skN2(p * 900.0) - 0.5) * 0.0012; }`)
      .replace('#include <lights_pars_begin>', `#include <lights_pars_begin>
        ${SKIN_LIGHTS}
        // DENTICLE SHEEN. Shark skin is tiled with tooth-like scales whose ridges all
        // run nose-to-tail, so its highlight is a Kajiya-Kay streak stretched ACROSS the
        // body axis, not a round spot. Reads the scene's own lights; adds none.
        vec3 shAniso(vec3 n, vec3 t, vec3 v, vec3 vpos){
          vec3 s = vec3(0.0);
          #if NUM_DIR_LIGHTS > 0
          for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
            vec3 l = directionalLights[i].direction; vec3 hv = normalize(l + v);
            float th = dot(t, hv); float st = sqrt(max(0.0, 1.0 - th * th));
            s += directionalLights[i].color * pow(st, 90.0) * max(0.0, dot(n, l));
          }
          #endif
          #if NUM_POINT_LIGHTS > 0
          for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
            vec3 lv = pointLights[i].position + vpos; float d = max(length(lv), 1e-3); vec3 l = lv / d;
            vec3 hv = normalize(l + v); float th = dot(t, hv); float st = sqrt(max(0.0, 1.0 - th * th));
            s += pointLights[i].color * getDistanceAttenuation(d, pointLights[i].distance, pointLights[i].decay) * pow(st, 90.0) * max(0.0, dot(n, l));
          }
          #endif
          return s;
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float body = step(vSuv.y, 1.5);
        float tooth = step(2.5, vSuv.y);
        float yy = clamp(vSuv.y, 0.0, 1.0);
        float t = vSuv.x, ar = vSsurf.y;
        vec3 V = normalize(vViewPosition);
        float h = 0.0, wet = 0.0;
        // ---- countershading: dark dorsal over a near-white belly, the line broken by
        // a ragged edge, the back darkest along the spine ----
        float ragged = (skN2(vec2(t * 26.0, ar * 9.0)) - 0.5) * 0.09;
        float cs = smoothstep(0.30, 0.40, yy + ragged);
        vec3 hide = mix(uPale, uDark * mix(1.12, 0.78, smoothstep(0.7, 1.0, yy)), cs);
        // dermal mottle: soft blotches and a fine freckle, never a regular pattern
        hide *= 0.88 + 0.18 * skFbm3(vec3(t * 14.0, ar * 5.0, 0.3)) + 0.05 * (skN2(vec2(t * 160.0, ar * 90.0)) - 0.5);
        // ---- denticles: ridges along the axis (sub-pixel beyond a few metres; the
        // sheen below carries them at range) ----
        vec2 dq = vec2(t * 420.0, ar * 1400.0);
        h += (0.5 + 0.5 * sin(dq.y + skN2(dq * 0.05) * 3.0)) * 0.18 * skAA(dq * vec2(0.02, 1.0));
        // ---- gill slits: the groove is geometry; inside it the gill tissue is dark red ----
        float gz = 0.0;
        for (int k = 0; k < 5; k++) {
          float gt = 0.186 + 0.021 * float(k) - 0.00025 * float(k * k);
          float s = yy * 2.0 - 1.0;
          float hk = 1.0 - 0.07 * float(k * k) * 0.25;
          float inY = step(-0.34 * hk - 0.05, s) * step(s, 0.46 * hk);
          gz = max(gz, (1.0 - smoothstep(0.0007, 0.0018, abs(t - gt - 0.006 * (s - 0.1)))) * inY);
        }
        hide = mix(hide, vec3(0.10, 0.025, 0.03), gz * 0.6);
        // ---- mouth: the dark line of the gape in the crescent groove ----
        float cm = cos(ar * 6.2831853);
        float mline = (1.0 - smoothstep(0.0015, 0.004, abs(t - 0.066 - 0.042 * cm * cm))) * step(yy, 0.36) * step(abs(cm), 0.9);
        hide = mix(hide, vec3(0.05, 0.015, 0.015), mline);
        // ---- scars: old healed rakes, paler and sunk, one set per animal ----
        vec2 sp = vec2(t, ar * 0.3);
        float sc = 0.0;
        sc = max(sc, 1.0 - smoothstep(0.0004, 0.0026, shSeg(sp, vec2(0.40, 0.031 + uScar * 0.07), vec2(0.53, 0.019 + uScar * 0.07))));
        sc = max(sc, 1.0 - smoothstep(0.0004, 0.0024, shSeg(sp, vec2(0.41, 0.024 + uScar * 0.07), vec2(0.54, 0.012 + uScar * 0.07))));
        sc = max(sc, 1.0 - smoothstep(0.0004, 0.0022, shSeg(sp, vec2(0.425, 0.017 + uScar * 0.07), vec2(0.53, 0.006 + uScar * 0.07))));
        sc = max(sc, 1.0 - smoothstep(0.0004, 0.0020, shSeg(sp, vec2(0.30, 0.122), vec2(0.37, 0.131))));
        sc = max(sc, 1.0 - smoothstep(0.0006, 0.0030, shSeg(sp, vec2(0.60 - uScar * 0.1, 0.121), vec2(0.72 - uScar * 0.1, 0.104))));
        sc *= body;
        hide = mix(hide, hide * 1.45 + vec3(0.06, 0.055, 0.05), sc * 0.8);
        h -= sc * 2.2;
        // ---- eye: a wet black dome (the dome is geometry), a thin pale rim, catchlight ----
        float eyeD = length(vec2((t - 0.092) / 0.012, (yy - 0.67) / 0.055));
        float eyeIn = 1.0 - smoothstep(0.78, 0.9, eyeD);
        float irisR = (1.0 - smoothstep(0.55, 0.7, eyeD)) * (1.0 - smoothstep(0.0, 0.1, 0.55 - eyeD));
        vec3 eyeC = mix(vec3(0.012, 0.014, 0.018), vec3(0.16, 0.13, 0.08), irisR * 0.5);
        hide = mix(hide, eyeC, eyeIn);
        hide *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.25, abs(eyeD - 1.0)));   // orbit fold
        wet = eyeIn * body;
        // ---- fins: dorsal tone above, pale under, with dusky trailing edges ----
        vec3 finc = mix(uPale, uDark, 0.72) * (1.0 - 0.3 * smoothstep(0.55, 1.0, vSsurf.y) * smoothstep(0.3, 1.0, vSsurf.x));
        vec3 alb = mix(finc, hide, body);
        alb = mix(alb, vec3(0.86, 0.84, 0.76), tooth);
        diffuseColor.rgb *= alb;
        normal = skBump(-vViewPosition, normal, h * 0.0012, faceDirection);
        roughnessFactor = mix(roughnessFactor, 0.05, wet);
        roughnessFactor = mix(roughnessFactor, 0.3, tooth);
        metalnessFactor = mix(metalnessFactor, 0.0, max(wet, tooth));
        // denticle sheen along the grain, and the eye's catchlight
        vec3 ax = normalize(vAxis - normal * dot(vAxis, normal));
        totalEmissiveRadiance += shAniso(normal, ax, V, vViewPosition) * uPale * 0.22 * (1.0 - wet) * (1.0 - tooth) * (1.0 - sc);
        totalEmissiveRadiance += skCatch(normal, V, vViewPosition) * wet;
        // faint wet sheen along the lateral line keeps the silhouette legible in murk
        float lat = (1.0 - smoothstep(0.012, 0.075, abs(yy - 0.46))) * body;
        totalEmissiveRadiance += uDark * lat * uSheen;`);
    injectStrokes(sh);   // SILHOUETTE STROKES (lib/paint.js)
  };
  return registerPaint(mat);
}

// ---------------------------------------------------------------------------
// SHARK — behaviour
// ---------------------------------------------------------------------------

const SHARK_CFG = [
  // sheen was dead weight until the lateral-line smoothstep fix; re-judged live:
  // the emissive is uDark (a dark hide tone) * sheen, so 0.10/0.30 read as a wet
  // glint, not a glow — authored values kept.
  { zi: 0, size: 6.6, dark: 0x35474f, pale: 0xd6e0dc, sheen: 0.10, patrolR: 62, scar: 0 },
  { zi: 1, size: 8.6, dark: 0x262c46, pale: 0x9fa9c4, sheen: 0.30, patrolR: 56, scar: 1 }
];

// Tuning, all in one place.
const SH = {
  patrolSpeed: 5.2, interestSpeed: 7.6, windupSpeed: 9.5, strikeSpeed: 22, fleeSpeed: 19,
  patrolTurn: 0.42, interestTurn: 0.75, windupTurn: 1.5, strikeTurn: 2.1, fleeTurn: 0.8,
  senseR: 90,                 // beyond this the diver simply isn't noticed
  interestIn: 0.55, interestOut: 0.28, strikeAt: 0.95,
  interestR: 25, windupR: 12,
  minInterest: 10,            // seconds of circling before a strike is even possible
  windupT: 1.6, strikeT: 3.0, fleeT: 3.5,
  biteR: 3.0, coolMin: 30, coolMax: 60
};

const sharks = [];

function buildShark(cfg) {
  const geo = sharkGeometry();
  const mat = sharkMaterial(cfg);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(cfg.size / 1.34);   // geometry is 1.34 long nose-to-tail-tip
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.castShadow = false;
  scene.add(mesh);

  const a = rng(0, TAU), r = cfg.patrolR;
  const S = {
    cfg, mesh, mat, u: mat.userData.u,
    pos: V3(Math.cos(a) * r, zoneMidY(cfg.zi), Math.sin(a) * r),
    fwd: V3(Math.cos(a + 1.57), 0, Math.sin(a + 1.57)).normalize(),
    center: V3(0, zoneMidY(cfg.zi), 0),
    state: 'patrol', tState: 0, arousal: 0, cool: 0, cruised: 0,
    orbitPh: a, orbitR: cfg.patrolR, speed: SH.patrolSpeed,
    beat: Math.random() * 30, arch: 0, roll: 0, bit: false, blinded: 0
  };
  sharks.push(S);
  return S;
}

function sharkSetState(S, s) { S.state = s; S.tState = 0; }

function updateShark(S, dt, t, p) {
  const cfg = S.cfg;
  const dx = p.pos.x - S.pos.x, dy = p.pos.y - S.pos.y, dz = p.pos.z - S.pos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-5;
  S.tState += dt;
  S.cool = Math.max(0, S.cool - dt);

  // ---- arousal: what makes a shark curious, and what makes it lose interest ----
  let excite = 0;
  if (dist < SH.senseR) {
    const prox = 1 - dist / SH.senseR;
    const spd = p.vel.length();
    excite = prox * (0.25 + clamp(spd / 14, 0, 1) * 0.80 + p.light * 0.50);
    // counterplay: stand still on the floor, and/or let the lantern burn low
    if (p.grounded && spd < 1.6) excite *= 0.25;
    if (p.light < 0.25) excite *= 0.40;
  }
  S.arousal = clamp(S.arousal + (excite - 0.42) * dt * 0.5, 0, 1.2);
  if (S.cool > 0) S.arousal = Math.min(S.arousal, 0.45);

  // ---- ink: the counterplay. A hunting shark that eats a cloud loses the diver ----
  // Checked before the FSM so the abort lands on the same frame the snout enters the
  // murk — a charge that continues for even a tenth of a second reads as a hit.
  const hunting = S.state === 'interest' || S.state === 'windup' || S.state === 'strike';
  if (hunting && cloudBreaksLock(S, p)) {
    sharkSetState(S, 'flee');
    S.arousal = 0;
    S.cool = Math.max(S.cool, CL.cool);
    S.bit = true;                 // no bite can land out of an aborted run
    S.blinded = 1;
  }
  S.blinded = Math.max(0, S.blinded - dt * 0.5);

  // ---- state machine ----
  switch (S.state) {
    case 'patrol':
      if (S.arousal > SH.interestIn && dist < SH.senseR * 0.8) { sharkSetState(S, 'interest'); S.orbitR = Math.min(dist, 55); }
      break;
    case 'interest':
      if (S.arousal < SH.interestOut) sharkSetState(S, 'patrol');
      else if (S.arousal > SH.strikeAt && S.tState > SH.minInterest && S.cool <= 0 && dist < 42) {
        sharkSetState(S, 'windup'); S.bit = false;
      }
      break;
    case 'windup':
      if (S.tState > SH.windupT) sharkSetState(S, 'strike');
      break;
    case 'strike':
      if (!S.bit && dist < SH.biteR) {
        S.bit = true; ev.bite = 1;
        sharkSetState(S, 'flee');
      } else if (S.tState > SH.strikeT) sharkSetState(S, 'flee');
      break;
    case 'flee':
      if (S.tState > SH.fleeT) {
        sharkSetState(S, 'patrol');
        S.arousal = 0; S.cool = rng(SH.coolMin, SH.coolMax);
        S.orbitR = cfg.patrolR;
      }
      break;
  }

  // ---- steering target per state ----
  let speed = SH.patrolSpeed, turn = SH.patrolTurn, wantArch = 0;
  const st = S.state;
  if (st === 'patrol') {
    // wide lazy circuits about a slowly drifting centre
    S.center.x = Math.sin(t * 0.021) * WORLD_R * 0.22;
    S.center.z = Math.cos(t * 0.017) * WORLD_R * 0.22;
    S.center.y = zoneMidY(cfg.zi) + Math.sin(t * 0.05) * 34;
    S.orbitPh += dt * 0.10;
    S.orbitR += (cfg.patrolR - S.orbitR) * Math.min(1, dt * 0.4);
    _a.set(S.center.x + Math.cos(S.orbitPh) * S.orbitR, S.center.y, S.center.z + Math.sin(S.orbitPh) * S.orbitR);
  } else if (st === 'flee') {
    speed = SH.fleeSpeed; turn = SH.fleeTurn;
    // a shark that just ate a cloud of ink does not leave on a lazy arc: it throws the
    // whole body into the turn, which is the read that makes the sac feel like a tool
    if (S.blinded > 0) { turn = SH.fleeTurn * (1 + S.blinded * 2.2); wantArch = -0.45 * S.blinded; }
    _a.set(S.pos.x - dx / dist * 120, S.pos.y - dy / dist * 30 + 8, S.pos.z - dz / dist * 120);
  } else {
    // interest / windup: circle the diver, tightening
    const wantR = st === 'windup' ? SH.windupR : SH.interestR;
    speed = st === 'windup' ? SH.windupSpeed : SH.interestSpeed;
    turn = st === 'windup' ? SH.windupTurn : SH.interestTurn;
    if (st === 'strike') {
      speed = SH.strikeSpeed; turn = SH.strikeTurn; wantArch = 0.25;
      // lead the diver slightly so the pass looks committed, not homing
      _a.copy(p.pos).addScaledVector(p.vel, 0.30);
    } else {
      const k = st === 'windup' ? Math.min(1, S.tState / SH.windupT) : 0;
      if (st === 'windup') wantArch = k;
      S.orbitR += (wantR - S.orbitR) * Math.min(1, dt * 0.9);
      S.orbitPh += dt * speed / Math.max(6, S.orbitR);
      _a.set(p.pos.x + Math.cos(S.orbitPh) * S.orbitR, p.pos.y + Math.sin(t * 0.31) * 3.5,
        p.pos.z + Math.sin(S.orbitPh) * S.orbitR);
      // The telegraph: over the wind-up the circling target slides onto the diver, so
      // the shark is already lined up when it commits. Without this it enters the run
      // travelling tangentially and the pass sails harmlessly by.
      if (k > 0) _a.lerp(p.pos, k * 0.85);
    }
  }

  // keep the circuit inside the world and off the seabed
  const hr = Math.hypot(_a.x, _a.z);
  if (hr > WORLD_R * 0.82) { const k = WORLD_R * 0.82 / hr; _a.x *= k; _a.z *= k; }
  const aFloor = terrainH(_a.x, _a.z, cfg.zi) + cfg.size * 0.55 + 3;
  _a.y = clamp(_a.y, aFloor, zoneTop(cfg.zi) - 8);

  _b.copy(_a).sub(S.pos);
  steer(S.fwd, _b, turn, dt);
  S.speed += (speed - S.speed) * Math.min(1, dt * (st === 'strike' ? 5.0 : 2.2));
  S.pos.addScaledVector(S.fwd, S.speed * dt);

  // hard terrain floor — nothing swims through the seabed
  const floor = terrainH(S.pos.x, S.pos.z, cfg.zi) + cfg.size * 0.42 + 1.2;
  if (S.pos.y < floor) { S.pos.y = floor; if (S.fwd.y < 0) { S.fwd.y *= -0.3; S.fwd.normalize(); } }
  const ceil = zoneTop(cfg.zi) - 5;
  if (S.pos.y > ceil) { S.pos.y = ceil; if (S.fwd.y > 0) { S.fwd.y *= -0.3; S.fwd.normalize(); } }
  const phr = Math.hypot(S.pos.x, S.pos.z);
  if (phr > WORLD_R * 0.95) { const k = WORLD_R * 0.95 / phr; S.pos.x *= k; S.pos.z *= k; }

  // ---- pose: heading + bank into the turn ----
  const bankWant = clamp(-(S.fwd.z * _b.x - S.fwd.x * _b.z) / Math.max(1, _b.length()) * 1.5, -0.7, 0.7);
  S.roll += (bankWant - S.roll) * Math.min(1, dt * 3);
  _m.lookAt(_c.set(0, 0, 0), _d.copy(S.fwd).negate(), UP);
  _q.setFromRotationMatrix(_m);
  S.mesh.position.copy(S.pos);
  S.mesh.quaternion.copy(_q);
  S.mesh.rotateZ(S.roll);

  // tail beat accelerates with intent; integrate phase so rate changes never pop
  const beatRate = 2.6 + S.speed * 0.55;
  S.beat += dt * beatRate;
  if (S.beat > 6283.18) S.beat -= 6283.18;
  S.arch += (wantArch - S.arch) * Math.min(1, dt * 4);
  S.u.uPhase.value = S.beat;
  S.u.uAmp.value = 0.030 + 0.032 * clamp(S.speed / SH.strikeSpeed, 0, 1) + S.arch * 0.020;
  S.u.uArch.value = S.arch;

  // Fade at the cull edge instead of a hard visible-pop (house pattern: ventlife's
  // uVis shrink). Scale-to-zero — no material/uniform churn. The band is 8 units
  // ABSOLUTE: at CULL*0.15 (~63u) the shark visibly changed SIZE while swimming
  // well inside sight range, which reads as a shader bug, not a fade.
  const vis = clamp((CULL - dist) / 8, 0, 1);
  S.mesh.visible = vis > 0;
  S.mesh.scale.setScalar((cfg.size / 1.34) * vis);

  // ---- threat feed ----
  const prox = clamp(1 - dist / 70, 0, 1);
  const base = st === 'strike' ? 1.0 : st === 'windup' ? 0.85 : st === 'interest' ? 0.55
    : st === 'flee' ? 0.30 : 0.10;
  const th = base * (0.35 + 0.65 * prox);
  if (th > ev.threat) ev.threat = th;
}

// ---------------------------------------------------------------------------
// OCTOPUS — geometry
// ---------------------------------------------------------------------------

// One merged geometry: a lathed mantle plus eight arm tubes. aOct packs
// (T along arm, arm angle, ring angle, kind) — kind 0 = mantle, 1 = arm. Everything
// about the pose is evaluated in the vertex shader from three uniforms, so eight
// liquid arms cost the CPU exactly nothing.
function octopusGeometry() {
  const pos = [], nrm = [], oct = [], idx = [];

  // ---- mantle: a closed egg-shaped sack, widest low, with two eye knobs ----
  // v = 0 at the underside pole, 1 at the crown. Closed at both ends so the animal
  // reads as a solid body rather than a hood or a bell.
  // polish-fauna: 16x16 -> 28x28 mantle, 13x6 -> 30x12 arms, so the silhouette
  // rounds and the oral face has room for its sucker rows.
  const MR = 28, MS = 28;
  const mProfile = v => 0.475 * Math.pow(Math.sin(Math.pow(v, 0.80) * Math.PI), 0.78);
  const mHeight = v => -0.30 + Math.pow(v, 0.92) * 1.02;
  const mBase = pos.length / 3;
  for (let i = 0; i <= MR; i++) {
    const v = i / MR, r = mProfile(v), y = mHeight(v);
    for (let j = 0; j < MS; j++) {
      const ang = j / MS * TAU;
      const c = Math.cos(ang), s = Math.sin(ang);
      // eye knobs: two bumps low on the sides, where an octopus actually carries them
      const eyeB = Math.pow(Math.max(0, Math.abs(c)), 10.0) * Math.max(0, 1 - Math.abs(v - 0.42) * 7.0) * 0.15;
      const rr = r + eyeB;
      // slightly wider than deep, so the sack lies rather than stands
      pos.push(c * rr * 1.06, y + eyeB * 0.25, s * rr * 0.90);
      const dr = (mProfile(Math.min(1, v + 0.03)) - mProfile(Math.max(0, v - 0.03)));
      const dy = (mHeight(Math.min(1, v + 0.03)) - mHeight(Math.max(0, v - 0.03)));
      nrm.push(c * dy, -dr, s * dy);
      oct.push(v, ang, 0, 0);
    }
  }
  for (let i = 0; i < MR; i++) for (let j = 0; j < MS; j++) {
    const a = mBase + i * MS + j, b = mBase + i * MS + (j + 1) % MS;
    idx.push(a, a + MS, b, b, a + MS, b + MS);
  }

  // ---- arms: eight tapering tubes, 6-sided ----
  const ARMS = 8, SEG = 30, SID = 12;
  for (let k = 0; k < ARMS; k++) {
    const ang = (k + 0.5) / ARMS * TAU;
    const base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const T = i / SEG;
      for (let j = 0; j < SID; j++) {
        const r = j / SID * TAU;
        pos.push(0, 0, 0);        // fully generated in the vertex shader
        nrm.push(0, 1, 0);
        oct.push(T, ang, r, 1);
      }
    }
    for (let i = 0; i < SEG; i++) for (let j = 0; j < SID; j++) {
      const a = base + i * SID + j, b = base + i * SID + (j + 1) % SID;
      idx.push(a, a + SID, b, b, a + SID, b + SID);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aOct', new THREE.Float32BufferAttribute(oct, 4));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(V3(), 3);
  return g;
}

// Arm kinematics, mirrored nowhere on the CPU because nothing on the CPU needs it:
//   rest   — arms splayed down and tucked against the rock, coiled short
//   active — arms lift and splay, and the ones facing the light reach for it
// Staggered phase per arm plus a T^2 drag term gives the liquid, lagging motion.
const OCT_DEFORM = /* glsl */`
  attribute vec4 aOct;
  uniform float uReach; uniform float uSeed; uniform float uActive; uniform float uGrab;
  uniform vec3 uDir;
  varying float vOctT; varying float vOctK; varying float vOctA; varying float vOctR;
  // the ring / azimuth angle as a unit vector: an angle varying wraps 2pi -> 0 across
  // one strip of the closed tube and interpolates backwards; cos/sin do not
  varying vec2 vOctCS;
  void octDeform(out vec3 P, out vec3 N){
    float kind = aOct.w;
    if (kind < 0.5) {
      // mantle: breathes, and swells upright as the animal rouses. At rest it is
      // squashed against the rock — half the read of the camouflage is the silhouette.
      float br = sin(uTime*0.9 + uSeed)*0.020;
      float flatten = 1.0 - uReach;
      P = position * vec3(1.0 + br + flatten*0.16, (1.0 - br) * (1.0 - flatten*0.34), 1.0 + br + flatten*0.16);
      P.y += uReach*0.22 + 0.34;
      N = normalize(normal);
    } else {
      float T = aOct.x, A = aOct.y, R = aOct.z;
      vec3 ca = vec3(cos(A), 0.0, sin(A));
      vec3 flatD = vec3(uDir.x, 0.0, uDir.z);
      flatD = length(flatD) > 1e-4 ? normalize(flatD) : ca;
      // only the arms facing the light commit to it; the rest hold station
      float w = pow(max(0.0, dot(ca, flatD)), 3.0) * uReach;
      // at rest the arms fold down and inward against the rock; roused, they splay,
      // and the ones facing the light stretch toward it
      // polish-fauna: at rest the arms lie OUT across the silt and curl, rather than
      // hanging as stubs under the mantle (visual only: reach/grab are CPU-side)
      vec3 restD = normalize(vec3(ca.x*1.15, -0.10, ca.z*1.15));
      vec3 openD = normalize(vec3(ca.x, -0.18, ca.z));
      vec3 actD  = normalize(mix(openD, normalize(uDir), w * 0.92));
      vec3 D = normalize(mix(restD, actD, uReach));
      float jitter = fract(sin(A*12.9898 + uSeed)*43758.5453);
      float len = mix(0.98, 1.72, uReach) * (0.84 + 0.32*jitter);
      vec3 rt = normalize(cross(D, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
      vec3 up2 = cross(rt, D);
      float ph = uTime*(1.15 + 0.55*uReach) + A*2.3 + uSeed;
      // T^1.6 drag, two harmonics out of phase: a chain that lags itself, i.e. liquid
      float drag = pow(T, 1.6);
      float amp = (0.20 + 0.34*uReach) * (1.0 + uGrab*0.55);
      float s1 = sin(T*4.4 - ph) * amp;
      float s2 = cos(T*2.9 - ph*0.68 + jitter*6.28) * amp * 0.85;
      vec3 c = D*(T*len) + rt*(s1*drag*len) + up2*(s2*drag*len);
      // curl: arm tips coil under, hard when idle, loosely when reaching
      c += up2 * (T*T*len * mix(-0.42, 0.16, uReach));
      c.y -= drag * 0.62 * (1.0 - uReach);   // at rest the arms drape flat on the silt
      // ...and lie ON it: a soft floor under the skirt, so a resting arm spreads and
      // curls across the ground instead of standing the mantle up on stilts
      float oFloor = -0.24 + (0.15 - 0.142 * T) * 0.9 + 0.02 * sin(T * 9.0 + A);
      c.y = mix(c.y, max(c.y, oFloor), 1.0 - uReach);
      float rad = (0.150 - 0.142*pow(T, 0.8)) * mix(0.94, 1.08, uReach);
      vec3 rn = rt*cos(R) + up2*sin(R);
      // the oral face is flattened, a keel runs along the aboral side: an arm, not a hose
      float oral = max(0.0, -sin(R));
      rad *= 1.0 - 0.22 * oral * oral + 0.06 * max(0.0, sin(R));
      P = c + rn*rad;
      P.xz += ca.xz * 0.24;                          // arms leave from the skirt
      P.y += 0.14;
      N = normalize(rn + D*0.12);
    }
    vOctT = aOct.x; vOctK = kind; vOctA = aOct.y; vOctR = aOct.z;
    float csA = kind < 0.5 ? aOct.y : aOct.z;
    vOctCS = vec2(cos(csA), sin(csA));
  }`;

function octopusMaterial(zi) {
  const P = OCT_PAL[zi];
  const u = {
    uTime, uReach: { value: 0 }, uSeed: { value: _pr() * 6.283 },
    uActive: { value: 0 }, uGrab: { value: 0 }, uDir: { value: V3(1, 0, 0) },
    uSkin: { value: new THREE.Color(P.skin) },
    uHot: { value: new THREE.Color(P.hot) },
    uGlow: { value: new THREE.Color(P.glow) }
  };
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.93, metalness: 0.0,
    side: THREE.DoubleSide, emissive: 0x000000
  });
  mat.userData.u = u;
  mat.customProgramCacheKey = () => 'abyssa-octopus-skin';
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        ${OCT_DEFORM}`)
      .replace('#include <beginnormal_vertex>', `
        vec3 _oP; vec3 _oN; octDeform(_oP, _oN);
        vec3 objectNormal = _oN;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = _oP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uSkin; uniform vec3 uHot; uniform vec3 uGlow;
        uniform float uActive; uniform float uGrab; uniform float uTime;
        varying float vOctT; varying float vOctK; varying float vOctA; varying float vOctR;
        varying vec2 vOctCS;
        ${SKIN_COMMON}`)
      .replace('#include <lights_pars_begin>', `#include <lights_pars_begin>
        ${SKIN_LIGHTS}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float isArm = step(0.5, vOctK);
        vec3 oV = normalize(vViewPosition);
        float oAng = atan(vOctCS.y, vOctCS.x);          // -pi..pi, seam-free
        // at rest the skin sits on the silt palette; rousing flushes it warmer
        vec3 skin = mix(uSkin, uHot, uActive*0.75);
        // skin coordinate: (along, around) — arm T x ring angle, or mantle v x azimuth
        vec2 sq = isArm > 0.5 ? vec2(vOctT * 22.0, oAng * 1.2732395) : vec2(vOctT * 13.0, oAng * 2.5464791);
        // PAPILLAE: soft warts that stand up as the animal rouses
        vec3 pv = skVor(sq * 2.2);
        float pap = (1.0 - smoothstep(0.0, 0.42, pv.x)) * (0.35 + 0.65 * uActive);
        // CHROMATOPHORES: pigment sacs that open (grow) when it flushes, closed dots at rest
        vec3 cv = skVor(sq * 6.5 + 3.1);
        float cr = mix(0.08, 0.34, uActive) * (0.6 + 0.8 * cv.z);
        float chrom = 1.0 - smoothstep(cr, cr + 0.1, cv.x);
        vec3 chromC = mix(vec3(0.34, 0.12, 0.06), vec3(0.62, 0.36, 0.12), step(0.6, cv.z));
        skin *= 0.52 + 0.3 * pap;
        skin = mix(skin, chromC * (0.45 + 0.7 * uActive), chrom * mix(0.45, 0.8, uActive) * skAA(sq * 6.5));
        float h = pap * 0.7 * skAA(sq * 2.2);
        float wet = 0.0; float pup = 0.0;
        // SUCKERS: two staggered rows of cups down the oral face, shrinking to the tip —
        // a pale raised rim round a dark sunk acetabulum
        float oral = max(0.0, -vOctCS.y);
        float sT = vOctT * 34.0 - vOctT * vOctT * 12.0;
        float rOff = oAng + 1.5707963;
        float suckA = 0.0, suckR = 0.0;
        for (int k = 0; k < 2; k++) {
          float side = k == 0 ? -1.0 : 1.0;
          vec2 l = vec2(fract(sT + 0.5 * float(k)) - 0.5, (rOff - side * 0.36) / 0.34);
          float d = length(l);
          suckR = max(suckR, 1.0 - smoothstep(0.03, 0.07, abs(d - 0.34)));
          suckA = max(suckA, 1.0 - smoothstep(0.2, 0.28, d));
        }
        float sK = isArm * smoothstep(0.55, 0.85, oral) * (1.0 - smoothstep(0.93, 1.0, vOctT)) * skAA(vec2(sT, oAng * 3.0));
        skin = mix(skin, vec3(0.78, 0.62, 0.52) * (0.6 + 0.3 * uActive), suckR * sK);
        skin = mix(skin, vec3(0.32, 0.16, 0.14), suckA * sK);
        h += (suckR * 1.4 - suckA * 1.2) * sK;
        // oral face paler, arm tips pale out
        skin *= mix(1.0, 1.25, isArm * smoothstep(0.3, 0.9, oral) * (1.0 - suckA * sK));
        skin *= mix(1.0, 1.14, isArm * pow(vOctT, 2.0));
        // EYES: on the mantle's two knobs — a wet dome, a brass iris, the horizontal slit
        float ea = min(abs(oAng), 3.1415927 - abs(oAng));
        vec2 el = vec2(ea / 0.15, (vOctT - 0.42) / 0.08);
        float ed = length(el);
        float eIn = (1.0 - isArm) * (1.0 - smoothstep(0.82, 1.0, ed));
        float slit = (1.0 - smoothstep(0.58, 0.68, abs(el.x))) * (1.0 - smoothstep(0.14, 0.22, abs(el.y) - 0.03 * uActive));
        vec3 iris = vec3(0.36, 0.30, 0.17) * (0.65 + 0.5 * skN2(vec2(atan(el.y, el.x) * 5.0, ed * 9.0)));
        skin = mix(skin, mix(iris, vec3(0.01, 0.01, 0.012), slit), eIn);
        skin *= 1.0 - 0.45 * (1.0 - isArm) * (1.0 - smoothstep(0.0, 0.14, abs(ed - 1.05)));   // lid fold
        h = mix(h, sqrt(max(0.0, 1.0 - ed * ed)) * 2.5, eIn);
        wet = eIn;
        diffuseColor.rgb *= skin;
        normal = skBump(-vViewPosition, normal, h * 0.012, faceDirection);
        roughnessFactor = mix(roughnessFactor * 0.8, 0.05, wet);
        totalEmissiveRadiance += skCatch(normal, oV, vViewPosition) * wet;
        // dim bioluminescent ring around the eyes / along reaching arms
        // a whisper of bioluminescence at the arm tips only — enough to catch the eye
        // in the dark, never enough to overwhelm the skin it sits on
        float tipGlow = step(0.5, vOctK) * pow(vOctT, 4.0);
        totalEmissiveRadiance += uGlow * (uActive*0.015 + uGrab*0.075) * (0.10 + tipGlow*0.90);`);
    injectStrokes(sh);   // SILHOUETTE STROKES (lib/paint.js)
  };
  return registerPaint(mat);
}

const OCT_PAL = [
  { skin: 0x33444c, hot: 0xc25c2e, glow: 0x5cffc4 },   // zone 0 — silt grey-teal
  { skin: 0x342c47, hot: 0x9d47b4, glow: 0xa878ff },   // zone 1 — indigo
  { skin: 0x2c221e, hot: 0xb04a1c, glow: 0xff9455 }    // zone 2 — near-black rust
];

// Tuning.
const OC = {
  wakeR: 8, breakR: 13, wakeT: 0.9, reachT: 1.1, grabT: 2.6, fleeT: 3.2, backT: 3.0,
  steal: 0.25, coolMin: 22, coolMax: 36, perZone: 3
};

const octos = [];

// A den is a boulder big enough to hide behind; the animal sits tucked at its base.
function pickDens(zi, n) {
  const top = zoneTop(zi), bot = zoneBottom(zi);
  const pool = [];
  for (let i = 0; i < rockColliders.length; i++) {
    const c = rockColliders[i];
    if (c.y > top + 40 || c.y < bot - 60) continue;
    if (c.r < 2.4) continue;
    pool.push(c);
  }
  const out = [];
  for (let k = 0; k < n && pool.length; k++) {
    const idx = (_pd() * pool.length) | 0;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function buildOctopuses() {
  const geo = octopusGeometry();
  _pd = denStream();   // fresh den stream — reseedDens() installs its own identically
  for (let zi = 0; zi < 3; zi++) {
    const dens = pickDens(zi, OC.perZone);
    for (const rock of dens) {
      const mat = octopusMaterial(zi);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      // Tucked against the outside of the boulder, not inside it: the rock is cover to
      // hide behind, and the silhouette has to break against it rather than vanish.
      const scale = 1.5 + _pd() * 0.7;
      const a = _pd() * TAU, r = rock.r + scale * 0.75;
      const x = rock.x + Math.cos(a) * r, z = rock.z + Math.sin(a) * r;
      const y = terrainH(x, z, zi) + 0.2;
      mesh.scale.setScalar(scale);
      scene.add(mesh);
      // the den mouth: a stride further out from the boulder, where a dropped lantern lies
      const mx = x + Math.cos(a) * 1.5, mz = z + Math.sin(a) * 1.5;
      octos.push({
        zi, mesh, mat, u: mat.userData.u,
        den: V3(x, y, z), pos: V3(x, y, z), jet: V3(), mouth: V3(mx, terrainH(mx, mz, zi) + 0.35, mz),
        state: 'den', tState: 0, cool: rng(0, 10), reach: 0, active: 0, grab: 0, thief: false
      });
    }
  }
}

function octSet(O, s) { O.state = s; O.tState = 0; }

function updateOctopus(O, dt, t, p, lp) {
  O.tState += dt;
  O.cool = Math.max(0, O.cool - dt);
  const lit = p.light > 0.15;
  const ld = O.pos.distanceTo(lp);
  const pd = O.pos.distanceTo(p.pos);

  let wantReach = 0, wantActive = 0, wantGrab = 0;

  switch (O.state) {
    case 'den':
      if (O.cool <= 0 && lit && ld < OC.wakeR) octSet(O, 'wake');
      break;
    case 'wake':
      wantActive = 1; wantReach = 0.5;
      if (!lit || ld > OC.breakR) { octSet(O, 'settle'); }
      else if (O.tState > OC.wakeT) octSet(O, 'reach');
      break;
    case 'reach':
      wantActive = 1; wantReach = 1;
      _a.copy(lp).sub(O.pos);
      if (_a.lengthSq() > 1e-4) O.u.uDir.value.copy(_a).normalize();
      if (!lit || ld > OC.breakR) octSet(O, 'settle');
      else if (O.tState > OC.reachT) {
        octSet(O, 'grab');
        // the roll: is this the grab that takes it?
        lantern.grabs++;
        O.thief = !lantern.stolen && theftRoll(lantern.grabs);
      }
      break;
    case 'grab': {
      wantActive = 1; wantReach = 1; wantGrab = 1;
      _a.copy(lp).sub(O.pos);
      if (_a.lengthSq() > 1e-4) O.u.uDir.value.copy(_a).normalize();
      ev.lightSteal = Math.max(ev.lightSteal, OC.steal);
      if (ev.threat < 0.20) ev.threat = 0.20;
      const snatch = O.thief && O.tState > LANT.snatchT && ld < OC.breakR;
      if (snatch || !lit || ld > OC.breakR || O.tState > OC.grabT) {
        if (snatch) {
          // THE SNATCH: the light goes with it. game.js sees lanternStolen and holds
          // player.light at 0; the glow below is the only lantern in the water now.
          lantern.stolen = true; lantern.carried = true; lantern.by = O; lantern.t = 0;
          ev.lanternTaken = true; ev.msg = MSG_LANTERN_TAKEN;
        }
        O.thief = false;
        // ink and go: the puff covers the escape, exactly as it should
        _b.copy(O.pos).sub(p.pos);
        if (_b.lengthSq() < 1e-4) _b.set(1, 0, 0.3);
        _b.normalize();
        spawnInk(O.pos, _b, 30, O.zi);
        O.jet.copy(_b).multiplyScalar(11).setY(3.2);
        octSet(O, 'flee');
      }
      break;
    }
    case 'flee': {
      // THE JET DEFORM. The body used to translate away with no arm answer — a prop on
      // a wire. For the first ~0.6s of flee the arms are held hard in the streamline,
      // trailing the jet (the squid's SQ_DEFORM pulse is the reference read): reach
      // stays pinned near the grab's 1.0 and uDir eases from the lantern to the jet's
      // wake, then the whole thing relaxes to the drift pose. Existing uniforms only.
      const jp = 1 - Math.min(1, O.tState / 0.6);
      wantActive = 0.6 + 0.4 * jp;
      wantReach = 0.18 + 0.82 * jp * jp;
      if (jp > 0 && O.jet.lengthSq() > 1e-4) {
        _a.copy(O.jet).multiplyScalar(-1).normalize();
        O.u.uDir.value.lerp(_a, Math.min(1, dt * 8)).normalize();
      }
      O.pos.addScaledVector(O.jet, dt);
      O.jet.multiplyScalar(Math.pow(0.35, dt));
      O.jet.y -= 3.0 * dt;
      if (O.tState > OC.fleeT) octSet(O, 'return');
      break;
    }
    case 'return': {
      wantActive = 0.25; wantReach = 0.10;
      const k = Math.min(1, dt * 1.1);
      O.pos.lerp(O.den, k);
      if (O.tState > OC.backT || O.pos.distanceToSquared(O.den) < 0.05) {
        O.pos.copy(O.den);
        // home with the lantern: it sits on it, and wakes for nothing
        if (lantern.stolen && lantern.by === O && lantern.carried) octSet(O, 'hoard');
        else { octSet(O, 'den'); O.cool = rng(OC.coolMin, OC.coolMax); }
      }
      break;
    }
    case 'hoard': {
      // Tucked at the den with the light under it. The arms stay a little live — the
      // read at the den is a glow with something moving on it, not a lamp on a rock.
      wantActive = 0.45; wantReach = 0.22;
      _a.copy(p.pos).sub(O.pos);
      if (_a.lengthSq() > 1e-4) O.u.uDir.value.copy(_a).normalize();
      if (!(lantern.stolen && lantern.by === O && lantern.carried)) { octSet(O, 'den'); O.cool = rng(OC.coolMin, OC.coolMax); }
      break;
    }
    case 'settle':
      wantActive = 0.3; wantReach = 0.12;
      if (O.tState > 1.2) { octSet(O, 'den'); O.cool = rng(6, 12); }
      break;
  }

  // never sink into the seabed
  const floor = terrainH(O.pos.x, O.pos.z, O.zi) + 0.2;
  if (O.pos.y < floor) { O.pos.y = floor; if (O.jet.y < 0) O.jet.y = 0; }
  O.mesh.position.copy(O.pos);

  O.reach += (wantReach - O.reach) * Math.min(1, dt * 2.6);
  O.active += (wantActive - O.active) * Math.min(1, dt * 2.0);
  O.grab += (wantGrab - O.grab) * Math.min(1, dt * 4.0);
  O.u.uReach.value = O.reach;
  O.u.uActive.value = O.active;
  O.u.uGrab.value = O.grab;

  // 130 predates the stratified fog; track the live sight wall (dens sit in the silt,
  // so this usually lands near the old figure, but never pops inside visible range).
  O.mesh.visible = pd < Math.min(CULL, 205);
}

// ---- the stolen lantern: one glow, one owner, one way back --------------------------
function buildLanternGlow() {
  const g = new THREE.Group();
  const halo = makeGlow(0xffc46a, 2.2);
  halo.material.fog = false;          // wayfinding through the silt, same rule as the raft lamp
  halo.material.opacity = 0.55;
  const core = makeGlow(0xfff1c8, 0.55);
  core.material.fog = false;
  core.material.opacity = 0.95;
  g.add(halo, core);
  g.visible = false;
  scene.add(g);
  lantern.glow = g; lantern.core = core; lantern.halo = halo;
}

// Where the light is right now: under the thief, or where it was dropped.
function lanternAt(out) {
  const O = lantern.by;
  if (lantern.carried && O) return out.copy(O.pos).addScaledVector(UP, O.mesh.scale.x * 0.55);
  return out.copy(lantern.pos);
}

// The thief lets go where it stands (knife, or Sal walking up to a hoarding animal).
function dropLantern(at, floorIt) {
  lantern.carried = false;
  lantern.pos.copy(at);
  if (floorIt && lantern.by) lantern.pos.y = terrainH(at.x, at.z, lantern.by.zi) + 0.35;
}

function updateLantern(dt, p) {
  if (lantern.pendingReturn) { lantern.pendingReturn = false; ev.lanternReturned = true; ev.msg = ev.msg || MSG_LANTERN_BACK; }
  if (!lantern.stolen) { if (lantern.glow.visible) lantern.glow.visible = false; return; }
  ev.lanternStolen = true;
  const O = lantern.by;
  lantern.t += dt;
  // tired of it: dropped at the den mouth, still lit
  if (lantern.carried && lantern.t > LANT.hold && O.state === 'hoard') {
    dropLantern(O.mouth, false);
    ev.msg = ev.msg || MSG_LANTERN_DROPPED;
    octSet(O, 'den'); O.cool = rng(OC.coolMin, OC.coolMax);
  }
  lanternAt(_c);
  // the way back: walk up to the light AT THE DEN — hoarded, or dropped. Not on the
  // way there: the snatch happens at arm's length and the flight home can pass Sal, and
  // either would hand it straight back without the walk that is the whole mechanic.
  const atRest = !lantern.carried || O.state === 'hoard';
  if (atRest && _c.distanceToSquared(p.pos) < LANT.reach * LANT.reach) {
    if (lantern.carried && O) {
      // it lets go and covers the retreat, the grab's own exit
      _b.copy(O.pos).sub(p.pos);
      if (_b.lengthSq() < 1e-4) _b.set(1, 0, 0.3);
      _b.normalize();
      spawnInk(O.pos, _b, 30, O.zi);
      O.jet.copy(_b).multiplyScalar(11).setY(3.2);
      octSet(O, 'flee');
    }
    lantern.stolen = false; lantern.carried = false; lantern.by = null;
    ev.lanternReturned = true; ev.msg = ev.msg || MSG_LANTERN_BACK;
    lantern.glow.visible = false;
    return;
  }
  // the glow: visible only in the thief's zone, swelling a little with distance so it
  // still reads as a point through the murk (the ember-sprite lesson, scaled down)
  const show = O && O.zi === activeZone;
  lantern.glow.visible = show;
  if (show) {
    lantern.glow.position.copy(_c);
    const d = _c.distanceTo(p.pos);
    const k = 1 + Math.min(2.2, d * 0.018);
    lantern.halo.scale.setScalar(2.2 * k);
    lantern.core.scale.setScalar(0.55 * Math.min(1.6, k));
  }
}

// ---------------------------------------------------------------------------
// ink puffs — shared pool, alpha-blended dark so it actually occludes
// ---------------------------------------------------------------------------

// 176 rather than 112: a vented sac is 60 billboards, and the mechanic only works if a
// second sac can be thrown while the first still hangs in the water. Two clouds plus an
// octopus puff is the worst realistic case, and the pool has to cover it or the older
// cloud visibly evaporates mid-fight.
const INK_N = 176;
let inkMesh = null;
const inkP = new Float32Array(INK_N * 3), inkV = new Float32Array(INK_N * 3);
const inkLife = new Float32Array(INK_N), inkMax = new Float32Array(INK_N);
const inkSize = new Float32Array(INK_N), inkTint = new Float32Array(INK_N * 3);
let inkHead = 0, inkAlive = 0;

const INK_COL = [[0.012, 0.020, 0.026], [0.014, 0.012, 0.026], [0.018, 0.013, 0.011]];

function buildInk() {
  const mat = billboardMaterial(THREE.NormalBlending,
    // Fade fully to 0 at range: mix(0.15, ...) kept a 15% alpha floor, so an ink
    // cloud never fully fogged out and read as a dark smudge past the sight wall.
    'gl_FragColor = vec4(vC.rgb, a * vC.a * vFog);');
  inkMesh = billboardField(INK_N, mat);
  inkMesh.renderOrder = 3;
  inkMesh.visible = false;
  scene.add(inkMesh);
}

// Scalar knobs rather than an options object: this is called from three places and an
// object literal per call would be an allocation on a gameplay beat.
//   spread  — radius of the initial cluster (how big the puff starts)
//   push    — how hard the particles are thrown against `dir`
//   lifeK   — life multiplier: 1 = octopus escape puff, ~1.4 = a vented sac
//   sizeK   — per-billboard size multiplier
function spawnInk(at, dir, n, zi, spread = 0.8, push = 1, lifeK = 1, sizeK = 1) {
  const col = INK_COL[zi];
  for (let k = 0; k < n; k++) {
    const i = inkHead; inkHead = (inkHead + 1) % INK_N;
    if (inkLife[i] <= 0) inkAlive++;
    const i3 = i * 3;
    inkP[i3] = at.x + rng(-spread, spread);
    inkP[i3 + 1] = at.y + rng(-spread * 0.6, spread * 1.2);
    inkP[i3 + 2] = at.z + rng(-spread, spread);
    // the puff hangs where it was released and slowly billows; the animal is what moves
    inkV[i3] = (rng(-0.7, 0.7) - dir.x * rng(0.8, 2.4)) * push;
    inkV[i3 + 1] = rng(-0.15, 0.7) * push;
    inkV[i3 + 2] = (rng(-0.7, 0.7) - dir.z * rng(0.8, 2.4)) * push;
    inkMax[i] = inkLife[i] = rng(4.5, 7.5) * lifeK;
    inkSize[i] = rng(2.4, 4.8) * sizeK;
    inkTint[i3] = col[0]; inkTint[i3 + 1] = col[1]; inkTint[i3 + 2] = col[2];
  }
}

// ---------------------------------------------------------------------------
// vented ink clouds — the *volume* a shark loses its target inside
// ---------------------------------------------------------------------------

// The billboards above are only the look. Behaviour needs a coarse volume to test
// against, so a vented sac also registers a sphere here: a handful of records, preallocated.
const CLOUD_N = 3;
const CL = { r0: 5.0, r1: 9.5, life: 8.0, headR: 14, cool: 20, n: 60 };
const clouds = [];
for (let i = 0; i < CLOUD_N; i++) clouds.push({ pos: V3(), r: CL.r0, life: 0 });

function spawnCloud(at) {
  let C = null;
  for (let i = 0; i < CLOUD_N; i++) if (clouds[i].life <= 0) { C = clouds[i]; break; }
  // all three already hanging in the water: pick the oldest rather than refuse
  if (!C) { C = clouds[0]; for (let i = 1; i < CLOUD_N; i++) if (clouds[i].life < C.life) C = clouds[i]; }
  C.pos.copy(at); C.r = CL.r0; C.life = CL.life;
  return C;
}

function updateClouds(dt) {
  for (let i = 0; i < CLOUD_N; i++) {
    const C = clouds[i];
    if (C.life <= 0) continue;
    C.life -= dt;
    // matches the billboards, which grow as they thin
    const u = 1 - Math.max(0, C.life) / CL.life;
    C.r = CL.r0 + (CL.r1 - CL.r0) * u;
    C.pos.y += 0.22 * dt;                 // ink is buoyant; it creeps upward
  }
}

// True when this shark should lose the diver: either it has driven its own head into
// the murk, or the diver is standing inside it and simply cannot be seen.
function cloudBreaksLock(S, p) {
  for (let i = 0; i < CLOUD_N; i++) {
    const C = clouds[i];
    if (C.life <= 0) continue;
    // the head, not the centroid — a shark aborts when its snout hits the wall of ink
    _k1.copy(S.pos).addScaledVector(S.fwd, S.cfg.size * 0.45);
    if (_k1.distanceToSquared(C.pos) < CL.headR * CL.headR) return true;
    const pr = C.r + 1.5;
    if (p.pos.distanceToSquared(C.pos) < pr * pr) return true;
  }
  return false;
}

function updateInk(dt) {
  if (!inkAlive) { if (inkMesh.visible) inkMesh.visible = false; return; }
  inkMesh.visible = true;
  const ap = inkMesh.geometry.attributes.aPos.array;
  const as = inkMesh.geometry.attributes.aSize.array;
  const ac = inkMesh.geometry.attributes.aCol.array;
  let alive = 0;
  for (let i = 0; i < INK_N; i++) {
    if (inkLife[i] <= 0) { as[i] = 0; ac[i * 4 + 3] = 0; continue; }
    inkLife[i] -= dt;
    if (inkLife[i] <= 0) { as[i] = 0; ac[i * 4 + 3] = 0; continue; }
    alive++;
    const i3 = i * 3;
    inkP[i3] += inkV[i3] * dt;
    inkP[i3 + 1] += inkV[i3 + 1] * dt;
    inkP[i3 + 2] += inkV[i3 + 2] * dt;
    const damp = Math.pow(0.25, dt);
    inkV[i3] *= damp; inkV[i3 + 1] = inkV[i3 + 1] * damp + 0.25 * dt; inkV[i3 + 2] *= damp;
    const u = 1 - inkLife[i] / inkMax[i];
    ap[i3] = inkP[i3]; ap[i3 + 1] = inkP[i3 + 1]; ap[i3 + 2] = inkP[i3 + 2];
    as[i] = inkSize[i] * (0.55 + u * 2.3);           // the cloud spreads as it thins
    const o = i * 4;
    ac[o] = inkTint[i3]; ac[o + 1] = inkTint[i3 + 1]; ac[o + 2] = inkTint[i3 + 2];
    ac[o + 3] = 0.98 * Math.min(1, (1 - u) * 2.6) * Math.min(1, u * 16);
  }
  inkAlive = alive;
  inkMesh.geometry.attributes.aPos.needsUpdate = true;
  inkMesh.geometry.attributes.aSize.needsUpdate = true;
  inkMesh.geometry.attributes.aCol.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// ink sacs — the pickup a dead squid leaves behind
// ---------------------------------------------------------------------------

// Deliberately the same pickup language as the light motes in rifts.js: a small faceted
// body, a tight glow, a wide halo, and a homing radius the player learns once and
// applies everywhere. The read is the palette — motes are green-white and weightless,
// sacs are near-black with a violet sheen and hang heavier in the water.
const SAC_N = 4;
const SAC = { life: 90, homeR: 11, takeR: 3.4, dissolve: 2.5 };
const sacs = [];
let sacGeo = null, sacMat = null;

function buildSacs() {
  sacGeo = new THREE.IcosahedronGeometry(0.46, 1);
  // wet and dark: low roughness so the lantern picks out two or three facets at a time,
  // which is all it takes for the thing to read as glistening rather than matte
  sacMat = new THREE.MeshStandardMaterial({
    color: 0x0e0a14, roughness: 0.17, metalness: 0.55,
    emissive: new THREE.Color(0x2a1046)
  });
  registerPaint(sacMat, { hero: true });   // authored glisten — the paint law leaves it
  for (let i = 0; i < SAC_N; i++) {
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(sacGeo, sacMat));
    grp.add(makeGlow(0x9a5cff, 3.2));
    const halo = makeGlow(0x6b2ad6, 7);
    halo.material.opacity = 0.20;
    grp.add(halo);
    grp.visible = false;
    scene.add(grp);
    sacs.push({ grp, alive: false, life: 0, ph: _pr() * 7, baseY: 0, spin: _pr() * 7 });
  }
}

function spawnSac(at) {
  let S = null;
  for (let i = 0; i < SAC_N; i++) if (!sacs[i].alive) { S = sacs[i]; break; }
  // four already in the water is plenty; recycle the one closest to dissolving
  if (!S) { S = sacs[0]; for (let i = 1; i < SAC_N; i++) if (sacs[i].life < S.life) S = sacs[i]; }
  S.grp.position.copy(at);
  S.baseY = at.y;
  S.alive = true; S.life = SAC.life;
  S.grp.visible = true;
  S.grp.scale.setScalar(1);
  return S;
}

function updateSacs(dt, t, p) {
  for (let i = 0; i < SAC_N; i++) {
    const S = sacs[i];
    if (!S.alive) continue;
    S.life -= dt;
    if (S.life <= 0) { S.alive = false; S.grp.visible = false; continue; }
    const g = S.grp;
    S.spin += dt * 0.8;
    g.rotation.y = S.spin;
    g.rotation.x = S.spin * 0.4;
    const d = g.position.distanceTo(p.pos);
    // hangs where it fell, lolling on the current, until the diver is close enough
    g.position.y = S.baseY + Math.sin(t * 1.15 + S.ph) * 0.55;
    if (d < SAC.homeR) {
      g.position.lerp(p.pos, Math.min(1, dt * clamp((SAC.homeR - d) / 8, 0, 1) * 2.2));
      S.baseY = g.position.y;
    }
    const pulse = 3.0 + 1.1 * Math.sin(t * 2.1 + S.ph);
    g.children[1].scale.setScalar(pulse);
    g.children[2].scale.setScalar(6.5 + 2.2 * Math.sin(t * 1.3 + S.ph * 1.7));
    // the last couple of seconds: it thins out and goes, rather than blinking off
    if (S.life < SAC.dissolve) g.scale.setScalar(Math.max(0.02, S.life / SAC.dissolve));
    if (d < SAC.takeR) {
      S.alive = false; S.grp.visible = false;
      ev.inkPickup++;
    }
  }
}

// ---------------------------------------------------------------------------
// SQUID — geometry (instanced: one shoal, one draw)
// ---------------------------------------------------------------------------

// Mantle along +Z with the pointed tail at -Z and the arm crown trailing forward, so
// the shoal reads as arms-first hovering. aSq packs (T, crownAngle, kind) — kind 0
// mantle, 1 fin, 2 arm, 3 tentacle. Arms sway entirely in the vertex shader.
function squidGeometry() {
  const pos = [], nrm = [], sq = [], idx = [];

  // polish-fauna: a denser mantle (24 x 16, seam column duplicated so the skin's
  // around-coordinate never runs backwards) that continues past the mantle collar
  // into a HEAD (v 1 .. 1.3) carrying two big eyes; the arms now leave the head.
  const MR = 24, MH = 7, MS = 16;
  const prof = v => {                          // v: 0 tail tip .. 1 head
    const s = Math.sin(Math.pow(v, 0.62) * Math.PI * 0.94);
    return Math.max(0.012, s * 0.20 * (1 - 0.30 * v * v));
  };
  const rMouth = prof(1);
  const head = h => {                          // h: 0 collar .. 1 arm crown
    const eyeBulge = Math.sin(Math.PI * Math.min(1, h * 1.3)) * 0.035;
    return { r: rMouth * 0.92 + 0.03 * Math.sin(Math.PI * h) + eyeBulge, z: 0.18 + h * 0.12 };
  };
  const cols = MS + 1;
  for (let i = 0; i <= MR + MH; i++) {
    let v, r, z;
    if (i <= MR) { v = i / MR; r = prof(v); z = -0.5 + v * 0.68; }
    else { const h = (i - MR) / MH; const hd = head(h); v = 1 + h * 0.3; r = hd.r; z = hd.z; }
    for (let j = 0; j <= MS; j++) {
      const ang = j / MS * TAU;
      const c = Math.cos(ang), s = Math.sin(ang);
      // eyes sit on the head's flanks: widen it sideways there
      const wide = v > 1 ? 1 + 0.25 * Math.abs(c) ** 3 * Math.sin(Math.PI * Math.min(1, (v - 1) / 0.3)) : 1;
      pos.push(c * r * wide, s * r, z);
      nrm.push(c, s, v > 1 ? 0 : 0.15);
      sq.push(v, ang, 0, 0);
    }
  }
  for (let i = 0; i < MR + MH; i++) for (let j = 0; j < MS; j++) {
    const a = i * cols + j, b = a + 1;
    idx.push(a, a + cols, b, b, a + cols, b + cols);
  }

  // caudal fins: rhomboid muscular flaps, a 6 x 4 grid each so the ripple bends
  // them smoothly; T (the ripple's amplitude key) grows outward from the root
  const flag = (verts, tris, kind) => {
    const base = pos.length / 3;
    for (const v of verts) { pos.push(v[0], v[1], v[2]); nrm.push(0, 1, 0); sq.push(v[3], v[4], 0, kind); }
    for (const tri of tris) idx.push(base + tri[0], base + tri[1], base + tri[2]);
  };
  const FA = 6, FO = 4;
  for (const s of [-1, 1]) {
    const verts = [], tris = [];
    for (let i = 0; i <= FA; i++) {
      const a = i / FA, z = -0.50 + a * 0.33;
      const root = prof(Math.max(0, (z + 0.5) / 0.68)) * 0.9;
      // never exactly zero: a collapsed row has no face to take a normal from
      const w = 0.27 * Math.max(0.03, Math.pow(Math.sin(Math.PI * Math.pow(a, 0.75)), 0.9));
      for (let j = 0; j <= FO; j++) {
        const o = j / FO;
        verts.push([s * (root + w * o), 0, z - o * 0.04 * Math.sin(Math.PI * a), 0.25 * a + 0.75 * o, o]);
      }
    }
    for (let i = 0; i < FA; i++) for (let j = 0; j < FO; j++) {
      const p = i * (FO + 1) + j;
      tris.push([p, p + FO + 1, p + 1], [p + 1, p + FO + 1, p + FO + 2]);
    }
    flag(verts, tris, 1);
  }

  // arm crown: 8 arms + 2 long feeding tentacles with clubs, 7-sided tubes
  const SSID = 7;
  const mk = (n, kind, segs, off) => {
    for (let k = 0; k < n; k++) {
      const ang = (k + off) / n * TAU;
      const base = pos.length / 3;
      for (let i = 0; i <= segs; i++) {
        const T = i / segs;
        for (let j = 0; j < SSID; j++) { pos.push(0, 0, 0); nrm.push(0, 1, 0); sq.push(T, ang, j / SSID * TAU, kind); }
      }
      for (let i = 0; i < segs; i++) for (let j = 0; j < SSID; j++) {
        const a = base + i * SSID + j, b = base + i * SSID + (j + 1) % SSID;
        idx.push(a, a + SSID, b, b, a + SSID, b + SSID);
      }
    }
  };
  mk(8, 2, 12, 0.5);
  mk(2, 3, 18, 0.25);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aSq', new THREE.Float32BufferAttribute(sq, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  safeNormals(g);   // the arms are posed entirely in the vertex shader
  return g;
}

const SQ_DEFORM = /* glsl */`
  attribute vec4 aSq;
  attribute vec3 aSqI;         // per-instance: phase, jet 0..1, death 0..1
  uniform float uTime;
  varying float vSqT; varying float vSqK; varying float vSqA; varying float vSqP;
  varying float vSqD; varying vec2 vSqCS; varying vec2 vSqF;
  void sqDeform(out vec3 P, out vec3 N){
    float kind = aSq.w;
    float ph = uTime*2.1 + aSqI.x;
    float die = aSqI.z;
    if (kind < 1.5) {
      // mantle + fins: the funnel squeeze that drives the jet
      float squeeze = aSqI.y;
      P = position;
      P.xy *= 1.0 - 0.26*squeeze;
      P.z *= 1.0 + 0.10*squeeze;
      // dying: the mantle clenches once and then goes slack and slightly wrinkled
      P.xy *= 1.0 - 0.30*die;
      P.z *= 1.0 + 0.16*die;
      if (kind > 0.5) {
        // fin undulation, a slow travelling ripple
        float T = aSq.x;
        P.y += sin(T*4.0 + ph*0.8)*0.055*T;
      }
      N = normalize(normal + vec3(0.0, 1e-4, 0.0));
    } else {
      float T = aSq.x, A = aSq.y, R = aSq.z;
      float longArm = step(2.5, kind);
      float len = mix(0.30, 0.62, longArm) * (1.0 + 0.22*aSqI.y);
      vec3 ca = vec3(cos(A), sin(A), 0.0);
      // arms fan out when hovering, clamp into a spear when jetting, and curl hard
      // inward and back over the crown in death — the single clearest signal of a kill
      float fan = mix(0.34, 0.10, aSqI.y);
      fan = mix(fan, 0.95, die);
      vec3 D = normalize(vec3(ca.xy*fan, 1.0 - 1.55*die));
      vec3 rt = normalize(cross(D, vec3(0.0, 0.0, 1.0)) + vec3(1e-4, 0.0, 0.0));
      vec3 up2 = cross(rt, D);
      float drag = T*T;
      float s1 = sin(T*4.2 - ph*1.5 + A*1.9) * (0.09 + 0.05*longArm) * (1.0 - 0.7*die);
      float s2 = cos(T*3.1 - ph*1.1 + A*2.7) * 0.07 * (1.0 - 0.7*die);
      vec3 c = vec3(0.0, 0.0, 0.29) + D*(T*len) + rt*(s1*drag*len*2.0) + up2*(s2*drag*len*2.0);
      float rad = (0.028 - 0.024*T) * mix(1.0, 0.7, longArm);
      // the feeding tentacles end in a CLUB: a flattened paddle of suckers
      rad *= 1.0 + longArm * 1.6 * smoothstep(0.72, 0.86, T) * (1.0 - smoothstep(0.93, 1.0, T));
      vec3 rn = rt*cos(R) + up2*sin(R);
      P = c + rn*rad;
      N = normalize(rn + D*0.2);
    }
    vSqT = aSq.x; vSqK = kind; vSqA = aSq.y; vSqP = aSqI.x; vSqD = die;
    float csA = kind < 1.5 ? aSq.y : aSq.z;
    vSqCS = vec2(cos(csA), sin(csA));
    vSqF = position.xz;
  }`;

function squidMaterial() {
  const u = {
    uTime,
    uSkin: { value: new THREE.Color(0x3a2f3e) },
    uGlow: { value: new THREE.Color(0x7fe6ff) },
    uPulse: { value: 0 }
  };
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.34, metalness: 0.30,
    side: THREE.DoubleSide, emissive: 0x000000
  });
  mat.userData.u = u;
  mat.customProgramCacheKey = () => 'abyssa-squid-skin';
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${SQ_DEFORM}`)
      .replace('#include <beginnormal_vertex>', `
        vec3 _sP; vec3 _sN; sqDeform(_sP, _sN);
        vec3 objectNormal = _sN;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = _sP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uSkin; uniform vec3 uGlow; uniform float uPulse; uniform float uTime;
        varying float vSqT; varying float vSqK; varying float vSqA; varying float vSqP;
        varying float vSqD; varying vec2 vSqCS; varying vec2 vSqF;
        ${SKIN_COMMON}`)
      .replace('#include <lights_pars_begin>', `#include <lights_pars_begin>
        ${SKIN_LIGHTS}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float sAng = atan(vSqCS.y, vSqCS.x);                 // seam-free around angle
        float isMantle = 1.0 - step(0.5, vSqK), isFin = step(0.5, vSqK) * (1.0 - step(1.5, vSqK)), isArmS = step(1.5, vSqK);
        float isHead = isMantle * step(1.0, vSqT);
        vec3 sV = normalize(vViewPosition);
        vec3 skin = uSkin * (0.62 + 0.22*sin(sAng*5.0 + vSqT*11.0));
        // CHROMATOPHORES: rust and umber pigment sacs over a pale iridescent ground,
        // pulsing open and shut in waves (a live squid's skin never holds still)
        vec2 cq = isFin > 0.5 ? vSqF * 60.0 : (isArmS > 0.5 ? vec2(vSqT * 40.0, sAng * 1.9) : vec2(vSqT * 34.0, sAng * 3.8197));
        vec3 cv = skVor(cq);
        float pulse = 0.5 + 0.5 * sin(uTime * 1.7 + cv.z * 6.2831 + vSqT * 6.0 + vSqP);
        float cr = mix(0.12, 0.36, pulse) * (0.6 + 0.8 * cv.z);
        float chrom = (1.0 - smoothstep(cr, cr + 0.1, cv.x)) * skAA(cq);
        vec3 chromC = mix(vec3(0.42, 0.13, 0.08), vec3(0.30, 0.18, 0.10), step(0.55, cv.z));
        skin = mix(skin * 1.25, chromC, chrom * 0.85);
        // chromatophores relax in death: the colour drains out to a pale slack grey
        skin = mix(skin, vec3(0.20, 0.19, 0.21), vSqD*0.75);
        skin *= mix(1.0, 1.35, isArmS);                      // arms paler than the mantle
        // the fin is a thin sheet: lighter, and lit through from behind
        float finK = isFin;
        // EYES: huge, on the head's flanks — a silvered iris ring round a black wet pupil
        float ea = min(abs(sAng), 3.1415927 - abs(sAng));
        vec2 el = vec2(ea / 0.62, (vSqT - 1.13) / 0.085);
        float ed = length(el);
        float eIn = isHead * (1.0 - smoothstep(0.85, 1.0, ed));
        float pupil = 1.0 - smoothstep(0.42, 0.52, ed);
        vec3 eyeC = mix(vec3(0.46, 0.5, 0.52) * (0.8 + 0.4 * skN2(vec2(atan(el.y, el.x) * 6.0, ed * 8.0))), vec3(0.008, 0.01, 0.014), pupil);
        skin = mix(skin, eyeC, eIn);
        skin *= 1.0 - 0.5 * isHead * (1.0 - smoothstep(0.0, 0.18, abs(ed - 1.05)));
        diffuseColor.rgb *= skin;
        float sh = chrom * 0.25 + eIn * sqrt(max(0.0, 1.0 - ed * ed)) * 2.2;
        normal = skBump(-vViewPosition, normal, sh * 0.02, faceDirection);
        roughnessFactor = mix(roughnessFactor, 0.05, eIn);
        metalnessFactor = mix(metalnessFactor, 0.0, eIn);
        totalEmissiveRadiance += diffuseColor.rgb * skTransmit(normal, vViewPosition) * finK * 0.45;
        totalEmissiveRadiance += skCatch(normal, sV, vViewPosition) * eIn;
        // PHOTOPHORES: discrete lamps in four ventral-lateral rows, and a strobe that
        // travels tail-to-head along them
        float rowA = min(abs(sAng + 1.1), abs(sAng + 2.04));
        float rowB = min(abs(sAng + 0.55), abs(sAng + 2.59));
        vec2 pl = vec2(fract(vSqT * 16.0) - 0.5, min(rowA, rowB) * 2.6);
        float lamp = (1.0 - smoothstep(0.07, 0.13, length(pl))) * isMantle * (1.0 - isHead) * step(0.12, vSqT);
        float row = lamp;
        float wave = pow(0.5 + 0.5*sin(vSqT*7.0 - uTime*5.5 + vSqP*3.0), 7.0);
        float tip  = step(1.5, vSqK) * pow(vSqT, 4.0);
        // dying photophores stutter for a moment at double rate, then go out for good
        float stut = mix(1.0, pow(0.5 + 0.5*sin(uTime*17.0 + vSqP*4.0), 2.0), step(0.02, vSqD));
        float lampsOut = (1.0 - vSqD) * (1.0 - vSqD);
        totalEmissiveRadiance += uGlow * uPulse * lampsOut * stut * (row*(wave*1.2 + 0.06) + tip*0.8 + 0.025);`);
    injectStrokes(sh);   // SILHOUETTE STROKES (lib/paint.js)
  };
  return registerPaint(mat);
}

// Tuning.
// THE KEEPERS. The shoal is the first SQ.shoal instances; the rest are keepers, sized
// at build (instanced buffers never grow at runtime) for the largest authored Mhor
// (5 wards x 3). Keepers are assigned by index round-robin across the live unlit
// wards, so a 5-ward Mhor is kept 3/3/2/2/2 and a smaller one more thickly.
const GUARD_N = 12;
const SQ = {
  shoal: 4, n: 4 + GUARD_N, sense: 130, orbitLo: 6, orbitHi: 12, jetImpulse: 10,
  // keepers: station radius about the ward, the reach at which a keeper nibbles the
  // lantern, how fast the station spring pulls (per second)
  guardR: 8.5, guardNibR: 7.5, guardK: 3.2,
  nibbleEveryMin: 4.5, nibbleEveryMax: 9, nibbleT: 2.2, nibbleR: 3.6, steal: 0.10,
  outLight: 0.12,
  // death + the resource loop
  spasmT: 0.42,               // the curl snaps closed this fast
  deadT: 4.0,                 // total time from kill to despawn
  sinkV: 1.9,                 // how fast the slack body drifts down
  scatterT: 3.4,              // the whole shoal bolts for this long
  scatterImp: 26,             // impulse away from the kill
  respawnMin: 60, respawnMax: 120
};

let squidMesh = null, squidMat = null, squidU = null, squidI = null;
const squids = [];
let squidGlow = null, squidNibbleT = 0, squidPulse = 0;
const GLOW_PER = 5;

function buildSquid() {
  const geo = squidGeometry();
  squidMat = squidMaterial();
  squidU = squidMat.userData.u;
  const inst = new Float32Array(SQ.n * 3);
  for (let i = 0; i < SQ.n; i++) inst[i * 3] = _pr() * 6.283;
  squidI = new THREE.InstancedBufferAttribute(inst, 3);
  geo.setAttribute('aSqI', squidI);
  squidMesh = new THREE.InstancedMesh(geo, squidMat, SQ.n);
  squidMesh.frustumCulled = false;
  squidMesh.visible = false;
  scene.add(squidMesh);

  const midY = zoneMidY(2);
  for (let i = 0; i < SQ.n; i++) {
    const a = rng(0, TAU), r = rng(40, 90);
    squids.push({
      i, pos: V3(Math.cos(a) * r, midY + rng(-30, 30), Math.sin(a) * r),
      vel: V3(), fwd: V3(0, 0, 1), size: rng(2.0, 3.0),
      jetT: rng(0, 1), jet: 0, orbitPh: rng(0, TAU), orbitR: rng(SQ.orbitLo, SQ.orbitHi),
      state: 'far', tState: 0, glow: 0,
      // combat: dead 0 = alive, 1 = corpse drifting, 2 = despawned and waiting
      dead: 0, deadT: 0, die: 0, respawn: 0, spin: 0, spinAx: V3(0, 1, 0),
      // keepers: role fixed at build, ward re-derived from the live targets (-1 = none)
      guard: i >= SQ.shoal, ward: -1
    });
  }

  const mat = billboardMaterial(THREE.AdditiveBlending, 'gl_FragColor = vec4(vC.rgb * vC.a * vFog, a);');
  squidGlow = billboardField(SQ.n * GLOW_PER, mat);
  squidGlow.renderOrder = 4;
  squidGlow.visible = false;
  scene.add(squidGlow);
}

// ---- squid death: the whole kill beat, spread over four seconds ----------------
// Honest rather than showy: one spasm, the lamps stutter out, then a slack body that
// tumbles down into the dark. Nothing here allocates; the flourish is a curve on `die`.
function killSquidAt(Q, at) {
  Q.dead = 1; Q.deadT = 0; Q.die = 0; Q.state = 'dead';
  // a little kick along the blade's line, then it goes limp
  Q.vel.multiplyScalar(0.25);
  Q.spin = 0;
  Q.spinAx.set(rng(-1, 1), rng(-0.4, 0.4), rng(-1, 1));
  if (Q.spinAx.lengthSq() < 1e-4) Q.spinAx.set(0, 1, 0);
  Q.spinAx.normalize();

  // small dark burst from the mantle — the animal's own ink, not a vented sac
  _k3.set(rng(-0.4, 0.4), -0.6, rng(-0.4, 0.4)).normalize();
  spawnInk(at || Q.pos, _k3, 14, 2, 0.5, 0.7, 0.45, 0.55);

  // the shoal bolts: every survivor takes an impulse straight away from the kill
  for (const R of squids) {
    if (R === Q || R.dead) continue;
    R.state = 'scatter'; R.tState = 0;
    _k3.copy(R.pos).sub(Q.pos);
    if (_k3.lengthSq() < 1e-4) _k3.set(rng(-1, 1), rng(-1, 1), rng(-1, 1));
    _k3.normalize();
    R.vel.addScaledVector(_k3, SQ.scatterImp);
    R.jet = 1; R.jetT = rng(0.25, 0.5);
    R.orbitR = rng(SQ.orbitLo, SQ.orbitHi);
  }
}

function stepDeadSquid(Q, dt, p, im, ia, gp, gs, gc) {
  if (Q.dead === 2) {
    // gone: drifting back in from the dark on a long timer, so the loop is never finite
    Q.respawn -= dt;
    if (Q.respawn <= 0) {
      const a = rng(0, TAU), r = rng(72, 96);
      Q.pos.set(Math.cos(a) * r, zoneMidY(2) + rng(-26, 26), Math.sin(a) * r);
      Q.vel.set(0, 0, 0); Q.fwd.set(0, 0, 1);
      Q.dead = 0; Q.die = 0; Q.deadT = 0; Q.glow = 0; Q.jet = 0; Q.jetT = rng(0, 1);
      // a keeper drifts back in and, if its ward is still unlit, takes the post again
      Q.state = Q.ward >= 0 ? 'guard' : 'far'; Q.tState = 0;
      // hand it straight back to the living path this frame — falling through to the
      // corpse code below would see the old deadT and bury it again on the spot
      return false;
    } else {
      const o = Q.i * 16;
      for (let k = 0; k < 16; k++) im[o + k] = 0;
      ia[Q.i * 3 + 1] = 0; ia[Q.i * 3 + 2] = 0;
      for (let k = 0; k < GLOW_PER; k++) {
        const gi = Q.i * GLOW_PER + k;
        gs[gi] = 0; gc[gi * 4 + 3] = 0;
      }
      return false;
    }
  }

  Q.deadT += dt;
  const s = Math.min(1, Q.deadT / SQ.spasmT);
  // the curl overshoots on the way closed — that snap is what reads as a spasm
  Q.die = s < 1 ? s * (1.18 - 0.18 * s) : 1;
  const flourish = 1 + 0.24 * Math.sin(Math.PI * s) * (1 - s * 0.35);
  const fade = clamp((SQ.deadT - Q.deadT) / 1.1, 0, 1);

  // limp: whatever momentum was left bleeds off, and it sinks
  Q.pos.addScaledVector(Q.vel, dt);
  Q.vel.multiplyScalar(Math.pow(0.30, dt));
  Q.vel.y -= SQ.sinkV * dt;
  if (Q.vel.y < -SQ.sinkV) Q.vel.y = -SQ.sinkV;
  const floor = terrainH(Q.pos.x, Q.pos.z, 2) + Q.size * 0.3 + 0.4;
  if (Q.pos.y < floor) { Q.pos.y = floor; Q.vel.y = 0; }
  Q.spin += dt * 0.9;

  _m.lookAt(_k1.set(0, 0, 0), _k2.copy(Q.fwd).negate(), UP);
  _q.setFromRotationMatrix(_m);
  _q2.setFromAxisAngle(Q.spinAx, Q.spin);
  _q.premultiply(_q2);
  _m.compose(Q.pos, _q, _sc.setScalar(Q.size * flourish * fade));
  const e = _m.elements, o = Q.i * 16;
  for (let k = 0; k < 16; k++) im[o + k] = e[k];
  ia[Q.i * 3 + 1] = 0;
  ia[Q.i * 3 + 2] = Q.die;

  // photophores gutter out with the body
  for (let k = 0; k < GLOW_PER; k++) {
    const gi = Q.i * GLOW_PER + k, g3 = gi * 3, g4 = gi * 4;
    const tt = k / (GLOW_PER - 1), zz = -0.42 + tt * 0.58;
    gp[g3] = Q.pos.x + Q.fwd.x * zz * Q.size;
    gp[g3 + 1] = Q.pos.y + Q.fwd.y * zz * Q.size - 0.14 * Q.size;   // ventral lamps (polish-fauna)
    gp[g3 + 2] = Q.pos.z + Q.fwd.z * zz * Q.size;
    const dying = (1 - Q.die) * (1 - Q.die) * fade;
    const flick = Math.pow(0.5 + 0.5 * Math.sin(Q.deadT * 26 - tt * 5 + Q.i * 2.1), 2);
    const amp = dying * (0.15 + 0.85 * flick);
    gs[gi] = Q.size * (0.06 + 0.12 * amp);
    gc[g4] = 0.34 * amp; gc[g4 + 1] = 0.72 * amp; gc[g4 + 2] = 0.86 * amp; gc[g4 + 3] = 1;
  }

  if (Q.deadT >= SQ.deadT) { Q.dead = 2; Q.respawn = rng(SQ.respawnMin, SQ.respawnMax); }
  return Q.pos.distanceToSquared(p.pos) < CULL * CULL;
}

// ---- the wards the keepers keep (fed by leviathan.js; copied, never held) ----------
const WARD_MAX = 6;
const wardT = { zi: -1, n: 0, pos: [], lit: new Uint8Array(WARD_MAX), stamp: 0 };
for (let i = 0; i < WARD_MAX; i++) wardT.pos.push(V3());

export function setWardTargets(zi, sigils) {
  if (zi < 0 || !sigils) { wardT.zi = -1; wardT.n = 0; return; }
  const n = Math.min(WARD_MAX, sigils.length);
  if (wardT.zi !== zi || wardT.n !== n) wardT.stamp++;   // a new sleeper: re-post
  wardT.zi = zi; wardT.n = n;
  for (let i = 0; i < n; i++) {
    wardT.pos[i].copy(sigils[i].grp.position);
    const lit = sigils[i].lit ? 1 : 0;
    if (wardT.lit[i] !== lit) wardT.stamp++;              // a ward went up: free its keepers
    wardT.lit[i] = lit;
  }
}

export function wardGuardCount(i) {
  if (wardT.n === 0 || activeZone !== 2) return 0;
  let n = 0;
  for (let k = SQ.shoal; k < squids.length; k++) {
    const Q = squids[k];
    if (Q.ward === i && !Q.dead) n++;
  }
  return n;
}

// Round-robin the keepers over the UNLIT wards. Runs whenever the target set changes
// (new sleeper, a ward lit, zone entered); a keeper whose ward is gone drifts as shoal.
let guardStamp = -1;
function postGuards() {
  guardStamp = wardT.stamp;
  let unlit = 0;
  for (let i = 0; i < wardT.n; i++) if (!wardT.lit[i]) unlit++;
  let k = 0;
  for (let q = SQ.shoal; q < squids.length; q++) {
    const Q = squids[q];
    let w = -1;
    if (unlit > 0) {
      // the k-th unlit ward, cycling
      let want = k % unlit, seen = 0;
      for (let i = 0; i < wardT.n; i++) { if (wardT.lit[i]) continue; if (seen++ === want) { w = i; break; } }
      k++;
    }
    if (Q.ward !== w) {
      Q.ward = w;
      if (!Q.dead) { Q.state = w >= 0 ? 'guard' : 'far'; Q.tState = 0; }
    }
  }
}

function updateSquid(dt, t, p, lp) {
  const lit = p.light > SQ.outLight;
  squidNibbleT -= dt;

  if (wardT.n === 0) { if (guardStamp !== -2) { guardStamp = -2; for (const Q of squids) if (Q.guard) { Q.ward = -1; if (!Q.dead && Q.state === 'guard') { Q.state = 'far'; Q.tState = 0; } } } }
  else if (guardStamp !== wardT.stamp) postGuards();

  // one nibbler at a time, and only when there is a light worth nibbling. A keeper
  // nibbles from its post when the lantern comes within guardNibR of it.
  if (lit && squidNibbleT <= 0) {
    squidNibbleT = rng(SQ.nibbleEveryMin, SQ.nibbleEveryMax);
    let best = null, bd = 1e9;
    for (const Q of squids) {
      if (Q.dead) continue;
      if (Q.state !== 'circle' && Q.state !== 'guard') continue;
      const d = Q.pos.distanceToSquared(lp);
      if (Q.state === 'guard' && d > SQ.guardNibR * SQ.guardNibR) continue;
      if (d < bd) { bd = d; best = Q; }
    }
    if (best && bd < 400) { best.state = 'nibble'; best.tState = 0; }
  }

  const gp = squidGlow.geometry.attributes.aPos.array;
  const gs = squidGlow.geometry.attributes.aSize.array;
  const gc = squidGlow.geometry.attributes.aCol.array;
  const im = squidMesh.instanceMatrix.array;
  const ia = squidI.array;
  let anyNear = false, maxProx = 0;

  for (const Q of squids) {
    if (Q.dead) {
      if (stepDeadSquid(Q, dt, p, im, ia, gp, gs, gc)) anyNear = true;
      continue;
    }
    Q.tState += dt;
    const dLight = Q.pos.distanceTo(lp);
    const dPlayer = Q.pos.distanceTo(p.pos);

    // ---- state ----
    // A kill outranks everything: the shoal will not come back to the light until the
    // panic has burned off, which is what makes one squid cost you the next few.
    const posted = Q.ward >= 0;          // a keeper with a ward to keep
    if (Q.state === 'scatter') {
      if (Q.tState > SQ.scatterT) { Q.state = posted ? 'guard' : lit ? 'approach' : 'flee'; Q.tState = 0; }
    }
    else if (posted) {
      // keepers hold their post lit or dark — they keep the ward, not the lantern
      if (Q.state === 'nibble') {
        if (dLight < SQ.nibbleR) ev.lightSteal = Math.max(ev.lightSteal, SQ.steal);
        if (Q.tState > SQ.nibbleT) { Q.state = 'guard'; Q.tState = 0; }
      } else if (Q.state !== 'guard') { Q.state = 'guard'; Q.tState = 0; }
    }
    else if (!lit) { if (Q.state !== 'flee') { Q.state = 'flee'; Q.tState = 0; } }
    else if (Q.state === 'far' || Q.state === 'flee') {
      if (dLight < SQ.sense) { Q.state = 'approach'; Q.tState = 0; }
    } else if (Q.state === 'approach') {
      if (dLight < SQ.orbitHi + 4) { Q.state = 'circle'; Q.tState = 0; }
    } else if (Q.state === 'nibble') {
      if (dLight < SQ.nibbleR) ev.lightSteal = Math.max(ev.lightSteal, SQ.steal);
      if (Q.tState > SQ.nibbleT) { Q.state = 'circle'; Q.tState = 0; Q.orbitR = rng(SQ.orbitLo, SQ.orbitHi); }
    }

    // ---- target ----
    let wantGlow = 0.15;
    if (Q.state === 'scatter') {
      // straight out and away from the lantern, lamps dumped to nearly nothing
      _a.copy(Q.pos).sub(lp);
      if (_a.lengthSq() < 1e-4) _a.set(1, 0.2, 0);
      _a.normalize().multiplyScalar(90).add(Q.pos);
      wantGlow = 0.02;
    } else if (Q.state === 'flee') {
      _a.copy(Q.pos).sub(lp);
      if (_a.lengthSq() < 1e-4) _a.set(1, 0, 0);
      _a.normalize().multiplyScalar(150).add(Q.pos);
      wantGlow = 0.03;
    } else if (Q.state === 'approach') {
      _a.copy(lp);
      wantGlow = 0.55;
    } else if (Q.state === 'nibble') {
      _a.copy(lp);
      wantGlow = 1.25;
    } else if (Q.state === 'circle') {
      Q.orbitPh += dt * 0.55;
      _a.set(lp.x + Math.cos(Q.orbitPh) * Q.orbitR, lp.y + Math.sin(t * 0.6 + Q.i) * 2.2,
        lp.z + Math.sin(Q.orbitPh) * Q.orbitR);
      wantGlow = 0.85;
    } else if (Q.state === 'guard') {
      // the post: a slow ring about the ward, each keeper on its own bearing
      Q.orbitPh += dt * 0.42;
      const wp = wardT.pos[Q.ward];
      const r = SQ.guardR + (Q.i % 3) * 1.6;
      _a.set(wp.x + Math.cos(Q.orbitPh) * r, wp.y + Math.sin(t * 0.7 + Q.i * 1.3) * 2.0,
        wp.z + Math.sin(Q.orbitPh) * r);
      wantGlow = 0.70;
    } else {
      // 'far' — drift the abyss on a slow loop
      Q.orbitPh += dt * 0.06;
      _a.set(Math.cos(Q.orbitPh) * 80, zoneMidY(2) + Math.sin(t * 0.07 + Q.i) * 30, Math.sin(Q.orbitPh) * 80);
      wantGlow = 0.10;
    }
    const aFloor = terrainH(_a.x, _a.z, 2) + 3;
    _a.y = clamp(_a.y, aFloor, zoneTop(2) - 6);

    // ---- jet propulsion: impulses, not thrust; drift between them ----
    Q.jetT -= dt;
    _b.copy(_a).sub(Q.pos);
    const td = _b.length() + 1e-5;
    if (Q.state === 'guard') {
      // A keeper RIDES its ward. The sleeper swims at 15 u/s; no jet economy holds
      // station on that, so the post is a spring, and the jet pulse is only the read.
      const k = 1 - Math.exp(-SQ.guardK * dt);
      Q.pos.lerp(_a, k);
      // velocity for the heading code: toward the post, plus the ring's tangent
      Q.vel.copy(_b).multiplyScalar(0.6);
      if (Q.jetT <= 0) { Q.jetT = rng(0.9, 1.6); Q.jet = 1; }
    } else if (Q.jetT <= 0) {
      const urgency = Q.state === 'scatter' ? 2.1 : Q.state === 'nibble' ? 1.7
        : Q.state === 'flee' ? 1.5 : Q.state === 'approach' ? 1.15 : 0.8;
      Q.jetT = rng(0.55, 1.05) / urgency;
      Q.jet = 1;
      // Scale the impulse to the distance left, or a squid aiming at the lantern sails
      // straight past it and the nibble never lands.
      const gain = 0.30 + 0.70 * Math.min(1, td / 7);
      Q.vel.addScaledVector(_b.divideScalar(td), SQ.jetImpulse * urgency * gain);
      _b.multiplyScalar(td);           // restore for the heading code below
    }
    Q.jet = Math.max(0, Q.jet - dt * 3.2);
    if (Q.state !== 'guard') {
      Q.vel.multiplyScalar(Math.pow(0.16, dt));
      Q.pos.addScaledVector(Q.vel, dt);
    }
    const floor = terrainH(Q.pos.x, Q.pos.z, 2) + Q.size * 0.4 + 0.8;
    if (Q.pos.y < floor) { Q.pos.y = floor; Q.vel.y = Math.abs(Q.vel.y) * 0.4; }
    const ceil = zoneTop(2) - 4;
    if (Q.pos.y > ceil) { Q.pos.y = ceil; Q.vel.y = -Math.abs(Q.vel.y) * 0.4; }
    const hr = Math.hypot(Q.pos.x, Q.pos.z);
    if (hr > WORLD_R * 0.9) { const k = WORLD_R * 0.9 / hr; Q.pos.x *= k; Q.pos.z *= k; }

    // heading follows travel; when nearly stopped, keep facing the light
    _c.copy(Q.vel);
    if (_c.lengthSq() < 0.35) _c.copy(_b);
    steer(Q.fwd, _c, 3.2, dt);

    _m.lookAt(_d.set(0, 0, 0), _c.copy(Q.fwd).negate(), UP);
    _q.setFromRotationMatrix(_m);
    _m.compose(Q.pos, _q, _sc.setScalar(Q.size));
    const e = _m.elements, o = Q.i * 16;
    for (let k = 0; k < 16; k++) im[o + k] = e[k];
    ia[Q.i * 3 + 1] = Q.jet;
    ia[Q.i * 3 + 2] = 0;

    Q.glow += (wantGlow - Q.glow) * Math.min(1, dt * 2.5);

    // ---- photophore halos: a row down the mantle, flickering in a travelling pulse ----
    for (let k = 0; k < GLOW_PER; k++) {
      const gi = Q.i * GLOW_PER + k, g3 = gi * 3, g4 = gi * 4;
      const tt = k / (GLOW_PER - 1);
      const zz = -0.42 + tt * 0.58;
      gp[g3] = Q.pos.x + Q.fwd.x * zz * Q.size;
      gp[g3 + 1] = Q.pos.y + Q.fwd.y * zz * Q.size - 0.14 * Q.size;   // ventral lamps (polish-fauna)
      gp[g3 + 2] = Q.pos.z + Q.fwd.z * zz * Q.size;
      const flick = Math.pow(0.5 + 0.5 * Math.sin(t * 5.5 - tt * 7 + Q.i * 2.1), 6);
      const amp = Q.glow * (0.25 + 0.95 * flick) * 0.9;
      gs[gi] = Q.size * (0.06 + 0.12 * amp);
      gc[g4] = 0.34 * amp; gc[g4 + 1] = 0.72 * amp; gc[g4 + 2] = 0.86 * amp; gc[g4 + 3] = 1;
    }

    if (dPlayer < CULL) anyNear = true;
    const prox = clamp(1 - dPlayer / 40, 0, 1) * (Q.state === 'nibble' ? 1 : 0.7);
    if (prox > maxProx) maxProx = prox;
    if (dLight < 60) squidPulse = Math.max(squidPulse, Q.glow);
  }

  squidMesh.instanceMatrix.needsUpdate = true;
  squidI.needsUpdate = true;
  squidGlow.geometry.attributes.aPos.needsUpdate = true;
  squidGlow.geometry.attributes.aSize.needsUpdate = true;
  squidGlow.geometry.attributes.aCol.needsUpdate = true;
  squidMesh.visible = anyNear;
  squidGlow.visible = anyNear;
  squidU.uPulse.value = squidPulse;
  squidPulse *= 0.9;

  const th = 0.26 * maxProx;
  if (th > ev.threat) ev.threat = th;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

let activeZone = -1;
let profN = 0, profSum = 0, profMax = 0;

export function buildPredators() {
  _pr = siteParams('predators').rng;
  for (const cfg of SHARK_CFG) buildShark(cfg);
  buildOctopuses();
  buildLanternGlow();
  buildInk();
  buildSquid();
  buildSacs();

  // Namespaced dev surface: teleport to each predator, read state, read cost.
  window.pred = {
    sharks, octos, squids,
    cost: () => ({
      frames: profN,
      avgMs: +(profSum / Math.max(1, profN)).toFixed(4),
      maxMs: +profMax.toFixed(4)
    }),
    resetCost: () => { profN = 0; profSum = 0; profMax = 0; },
    zone: zi => { switchPredatorZone(zi); return activeZone; },
    ev: () => ({
      threat: +ev.threat.toFixed(3), bite: ev.bite,
      lightSteal: +ev.lightSteal.toFixed(3), inkPickup: ev.inkPickup
    }),
    // Steady-state cost, measured off the render loop so a throttled rAF can't skew it.
    bench: (n = 1000, pl = null, lp = null) => {
      const p = pl || window.player;
      const t0 = performance.now();
      let t = 0;
      for (let i = 0; i < n; i++) { t += 1 / 60; updatePredators(1 / 60, t, p, lp || _lp); }
      const total = performance.now() - t0;
      return { frames: n, msPerFrame: +(total / n).toFixed(4), totalMs: +total.toFixed(1) };
    },
    state: () => ({
      zone: activeZone,
      shark: sharks.filter(s => s.cfg.zi === activeZone)
        .map(s => ({ state: s.state, arousal: +s.arousal.toFixed(2), cool: +s.cool.toFixed(1), d: 0 })),
      octo: octos.filter(o => o.zi === activeZone).map(o => ({ state: o.state, reach: +o.reach.toFixed(2) })),
      squid: activeZone === 2
        ? squids.map(q => q.dead === 2 ? `gone(${q.respawn.toFixed(0)}s)`
          : q.dead ? `dead(${q.deadT.toFixed(1)}s)` : q.state)
        : [],
      ink: inkAlive,
      clouds: clouds.filter(c => c.life > 0).map(c => ({ life: +c.life.toFixed(1), r: +c.r.toFixed(1) })),
      sacs: sacs.filter(s => s.alive).length
    }),
    // Debug teleports. Pass a player object in (game.js exposes window.player).
    goShark: pl => {
      const S = sharks.find(s => s.cfg.zi === activeZone);
      if (!S) return 'no shark in this zone';
      pl.pos.set(S.pos.x + 18, S.pos.y, S.pos.z + 18); pl.vel.set(0, 0, 0);
      return S.state;
    },
    goOcto: pl => {
      const O = octos.find(o => o.zi === activeZone);
      if (!O) return 'no octopus in this zone';
      pl.pos.set(O.den.x + 4, O.den.y + 2.5, O.den.z + 4); pl.vel.set(0, 0, 0);
      return O.state;
    },
    goSquid: pl => {
      if (activeZone !== 2) return 'squid live in zone 2';
      const Q = squids[0];
      pl.pos.copy(Q.pos).y += 4; pl.vel.set(0, 0, 0);
      return Q.state;
    },
    // Force behaviours so each beat can be screenshotted on demand.
    arouse: (v = 1.0) => { for (const s of sharks) if (s.cfg.zi === activeZone) { s.arousal = v; s.cool = 0; } return 'ok'; },
    strike: () => {
      const S = sharks.find(s => s.cfg.zi === activeZone);
      if (!S) return 'none';
      S.arousal = 1.2; S.cool = 0; S.bit = false; sharkSetState(S, 'windup');
      return 'windup';
    },
    ink: () => {
      const O = octos.find(o => o.zi === activeZone && o.state === 'grab') ||
        octos.find(o => o.zi === activeZone);
      if (!O) return 'none';
      _b.set(1, 0.2, 0.4).normalize();
      spawnInk(O.pos, _b, 30, O.zi);
      O.jet.copy(_b).multiplyScalar(11).setY(3.2);
      octSet(O, 'flee');
      return 'inked';
    },
    // ---- combat dev helpers ----
    // The real entry points, so a swing can be tested from the console with the
    // diver's own position and heading rather than a synthesised one.
    slash: (pos, fwd, range = 3.4) => slash(pos, fwd, range),
    vent: pos => deployInk(pos),
    // Kill the nearest living squid to the player (or index i) without needing to aim.
    killSquid: (pl = window.player) => {
      if (activeZone !== 2) return 'squid live in zone 2';
      let best = null, bd = 1e9;
      for (const Q of squids) {
        if (Q.dead) continue;
        const d = pl ? Q.pos.distanceToSquared(pl.pos) : 0;
        if (d < bd) { bd = d; best = Q; }
      }
      if (!best) return 'no living squid';
      killSquidAt(best, best.pos);
      spawnSac(best.pos);
      return { killed: best.i, at: best.pos.toArray().map(v => +v.toFixed(1)) };
    },
    // Drop a sac in front of the diver so the pickup can be inspected in any zone.
    spawnSac: (pl = window.player) => {
      const at = pl ? _k1.copy(pl.pos).add(_k2.set(0, -1.2, 0)) : _k1.set(0, 0, 0);
      spawnSac(at);
      return sacs.filter(s => s.alive).length;
    },
    // Vent a cloud at the diver and report every hunting shark's reaction.
    testInk: (pl = window.player) => {
      const before = sharks.filter(s => s.cfg.zi === activeZone).map(s => s.state);
      const ok = deployInk(pl ? pl.pos : V3());
      return { spawned: ok, sharkBefore: before, clouds: clouds.filter(c => c.life > 0).length };
    },
    // Fast-forward the slow timers (squid respawn, sac dissolve) instead of waiting.
    warp: (sec = 60) => {
      for (const Q of squids) if (Q.dead === 2) Q.respawn -= sec;
      for (const S of sacs) if (S.alive) S.life -= sec;
      return `warped ${sec}s`;
    },
    lure: () => {
      squidNibbleT = 0;
      for (const q of squids) { if (q.dead) continue; q.state = 'approach'; q.tState = 0; }
      return 'lured';
    },
    dens: zi => octos.filter(o => o.zi === zi).map(o => ({ x: +o.den.x.toFixed(1), y: +o.den.y.toFixed(1), z: +o.den.z.toFixed(1) })),
    // ---- THE LANTERN THEFT ----
    lantern: () => ({
      stolen: lantern.stolen, carried: lantern.carried, t: +lantern.t.toFixed(1), grabs: lantern.grabs,
      by: lantern.by ? { zi: lantern.by.zi, state: lantern.by.state, den: lantern.by.den.toArray().map(v => +v.toFixed(1)) } : null,
      at: lantern.stolen ? lanternAt(_k1).toArray().map(v => +v.toFixed(1)) : null,
      glowVisible: lantern.glow.visible
    }),
    // Force a theft: the nearest den octopus of the zone comes to the diver and snatches.
    steal: (pl = window.player) => {
      if (lantern.stolen) return 'already stolen';
      const O = octos.find(o => o.zi === activeZone && (o.state === 'den' || o.state === 'settle'));
      if (!O) return 'no octopus at rest in this zone';
      O.pos.copy(pl.pos).add(_k2.set(1.6, -0.6, 1.2)); O.mesh.position.copy(O.pos);
      O.cool = 0; O.thief = true; octSet(O, 'grab'); O.tState = LANT.snatchT + 0.05;
      return 'snatching';
    },
    lp: () => _lp.toArray().map(v => +v.toFixed(1)),
    // Fast-forward the hold timer (the 90 s drop).
    warpLantern: (sec = 90) => { lantern.t += sec; return +lantern.t.toFixed(1); },
    // ---- MHOR'S KEEPERS ----
    guards: () => ({
      wards: wardT.n, zone: wardT.zi,
      perWard: Array.from({ length: wardT.n }, (_, i) => wardGuardCount(i)),
      keepers: squids.filter(q => q.guard).map(q => ({ i: q.i, ward: q.ward, state: q.dead ? 'dead' : q.state,
        d: q.ward >= 0 ? +q.pos.distanceTo(wardT.pos[q.ward]).toFixed(1) : null }))
    }),
    // Kill every living keeper on ward i (or all wards), the way spear + knife would.
    killGuards: (i = -1) => {
      let n = 0;
      for (const Q of squids) {
        if (!Q.guard || Q.dead || Q.ward < 0 || (i >= 0 && Q.ward !== i)) continue;
        killSquidAt(Q, Q.pos); n++;
      }
      return `killed ${n}`;
    },
    // Park the diver beside ward i's post.
    goWard: (i = 0, pl = window.player) => {
      if (wardT.n === 0) return 'no wards posted (zone 2, sleeper awake)';
      const wp = wardT.pos[Math.min(i, wardT.n - 1)];
      pl.pos.set(wp.x + 6, wp.y + 2, wp.z + 6); pl.vel.set(0, 0, 0);
      return `ward ${i} @ ${wp.x.toFixed(1)}, ${wp.y.toFixed(1)}, ${wp.z.toFixed(1)}`;
    }
  };
}

// Called once by the ending: predators are story-irrelevant during the rite, and
// game.js stops ticking updatePredators the moment state goes 'won', so a shark
// frozen mid-patrol would hang in the flythrough's path forever. A blunt hide is
// self-healing — every visibility here is re-derived per frame if play ever resumes.
export function hidePredators() {
  for (const S of sharks) S.mesh.visible = false;
  for (const O of octos) O.mesh.visible = false;
  if (lantern.glow) lantern.glow.visible = false;
  if (squidMesh) { squidMesh.visible = false; squidGlow.visible = false; }
  if (inkMesh) inkMesh.visible = false;
  for (const S of sacs) { S.alive = false; S.grp.visible = false; }
}

export function switchPredatorZone(zi) {
  activeZone = zi;
  // Leaving the thief's zone mid-theft: it drops the light at its den mouth, where it
  // waits (the octopus below is reset to 'den' like every other one).
  if (lantern.stolen && lantern.carried && lantern.by && lantern.by.zi !== zi) dropLantern(lantern.by.mouth, false);
  for (const S of sharks) {
    const on = S.cfg.zi === zi;
    if (!on) { S.mesh.visible = false; continue; }
    // reset the hunter so the zone opens on a distant patrol, never mid-strike
    sharkSetState(S, 'patrol');
    S.arousal = 0; S.cool = rng(12, 22); S.orbitR = S.cfg.patrolR; S.bit = false; S.blinded = 0;
    S.pos.set(Math.cos(S.orbitPh) * S.cfg.patrolR, zoneMidY(zi), Math.sin(S.orbitPh) * S.cfg.patrolR);
  }
  for (const O of octos) {
    if (O.zi !== zi) { O.mesh.visible = false; continue; }
    O.pos.copy(O.den); O.mesh.position.copy(O.den);
    octSet(O, 'den'); O.cool = rng(3, 12); O.reach = 0; O.active = 0; O.grab = 0;
    // back into the thief's zone: it is still sitting on the light
    if (lantern.stolen && lantern.carried && lantern.by === O) octSet(O, 'hoard');
  }
  if (zi !== 2) {
    squidMesh.visible = false; squidGlow.visible = false;
  } else {
    for (const Q of squids) {
      if (Q.dead === 1) { Q.dead = 2; Q.respawn = rng(SQ.respawnMin, SQ.respawnMax); continue; }
      if (Q.dead) continue;             // still out there waiting to drift back in
      Q.state = 'far'; Q.tState = 0;
    }
    guardStamp = -1;                    // re-post the keepers against the live wards
  }
  // Any ink hanging in the old zone would otherwise float in the new one.
  for (let i = 0; i < INK_N; i++) inkLife[i] = 0;
  inkAlive = 0;
  if (inkMesh) inkMesh.visible = false;
  for (let i = 0; i < CLOUD_N; i++) clouds[i].life = 0;
  for (let i = 0; i < SAC_N; i++) { sacs[i].alive = false; sacs[i].grp.visible = false; }
}

// The one stale-state fix a new dive site needs: octopus dens are the only predator
// state permanently cached against a build-time world position. `pickDens` reads
// `rockColliders` live (flora refills the same array reference on rebuild, never
// swaps it), so calling it again here re-picks real, currently-standing boulders.
//
// Everything else self-corrects without help: sharks and squid re-sample `terrainH`
// every frame (see the `floor`/`aFloor`/`ceil` clamps in updateShark/updateSquid), so
// a shark or squid whose cached `pos` now sits inside or above new terrain is pushed
// back onto it on the very next tick — no explicit reset needed. Shark patrol centres
// are a function of live `t`, not a cached point. Ink sacs and vented clouds are
// runtime pickups spawned at kill/vent positions, not flora-anchored, and are already
// cleared by switchPredatorZone; reseedDens leaves them alone.
//
// Mid-chase safety: this rewrites `den`/`pos`/`mesh.position` and forces the FSM back
// to 'den' with reach/active/grab decayed to 0 — an octopus that was mid-reach or
// mid-grab simply lets go and reappears camouflaged at its (new) den, same as a normal
// cooldown return. `ev` is not touched: it is fully rebuilt every frame at the top of
// updatePredators, so this reset cannot leak a stale threat/lightSteal tick.
export function reseedDens() {
  // A stolen lantern does not sail with the thief: the world under it is gone, so the
  // light comes back to Sal on the next frame (the edge is reported, never lost).
  if (lantern.stolen) { lantern.stolen = false; lantern.carried = false; lantern.by = null; lantern.pendingReturn = true; }
  // A new site's Mhor is fully kept: every keeper alive and waiting for its post.
  for (let q = SQ.shoal; q < squids.length; q++) {
    const Q = squids[q];
    Q.dead = 0; Q.die = 0; Q.deadT = 0; Q.glow = 0; Q.jet = 0; Q.ward = -1;
    Q.state = 'far'; Q.tState = 0; Q.vel.set(0, 0, 0);
  }
  guardStamp = -1;
  // Same stream, same draw order as buildOctopuses (scale slot burnt below), so a
  // boot at a site and an arrive() back to it place bit-identical dens.
  _pd = denStream();
  for (let zi = 0; zi < 3; zi++) {
    const group = octos.filter(o => o.zi === zi);
    if (!group.length) continue;
    const dens = pickDens(zi, group.length);
    for (let i = 0; i < group.length; i++) {
      const rock = dens[i];
      // Pool came up short (fewer big rocks at this site than octopuses built for it) —
      // same tolerance buildOctopuses already has; leaving this one at its last den is
      // no worse than the shipped shortfall behaviour.
      if (!rock) continue;
      const O = group[i];
      void _pd();                      // burn the scale slot buildOctopuses drew
      const scale = O.mesh.scale.x;
      const a = _pd() * TAU, r = rock.r + scale * 0.75;
      const x = rock.x + Math.cos(a) * r, z = rock.z + Math.sin(a) * r;
      const y = terrainH(x, z, zi) + 0.2;
      O.den.set(x, y, z);
      const mx = x + Math.cos(a) * 1.5, mz = z + Math.sin(a) * 1.5;
      O.mouth.set(mx, terrainH(mx, mz, zi) + 0.35, mz);
      O.thief = false;
      O.pos.copy(O.den);
      O.jet.set(0, 0, 0);
      O.mesh.position.copy(O.den);
      octSet(O, 'den');
      O.cool = rng(3, 12);
      O.reach = 0; O.active = 0; O.grab = 0;
      O.u.uReach.value = 0; O.u.uActive.value = 0; O.u.uGrab.value = 0;
    }
  }
}

export function updatePredators(dt, t, p, lanternPos) {
  const t0 = performance.now();
  ev.threat = 0; ev.bite = 0; ev.lightSteal = 0; ev.inkPickup = 0;
  ev.lanternStolen = false; ev.lanternTaken = false; ev.lanternReturned = false; ev.msg = null;
  uTime.value = t;
  if (scene.fog) {
    uFogD.value = scene.fog.density;
    // same formula as creatures.js cullR: range where green transmittance hits 2%
    CULL = Math.min(CULL_MAX, 3.912 / Math.max(scene.fog.density * 1.45, 1e-4));
  }

  // lanternPos is written at the end of game.js's frame, so on frame one it is still
  // the origin — fall back to the diver himself rather than luring everything to (0,0,0).
  if (lanternPos && lanternPos.lengthSq() > 1) _lp.copy(lanternPos);
  else _lp.copy(p.pos);

  for (let i = 0; i < sharks.length; i++) {
    const S = sharks[i];
    if (S.cfg.zi !== activeZone) continue;
    updateShark(S, dt, t, p);
  }
  for (let i = 0; i < octos.length; i++) {
    const O = octos[i];
    if (O.zi !== activeZone) continue;
    updateOctopus(O, dt, t, p, _lp);
  }
  if (activeZone === 2) updateSquid(dt, t, p, _lp);
  updateLantern(dt, p);
  updateInk(dt);
  updateClouds(dt);
  updateSacs(dt, t, p);

  const ms = performance.now() - t0;
  profN++; profSum += ms; if (ms > profMax) profMax = ms;
  return ev;
}

// ---------------------------------------------------------------------------
// combat
// ---------------------------------------------------------------------------

// A cone, not a sphere: within `range` and inside ~70 degrees of where the diver is
// actually looking. cos(70 deg) = 0.342. Nearest valid target wins, so a slash into a
// cluster kills the one the blade would have reached first.
const SLASH_COS = 0.342;
const slashResult = { killed: '', at: V3() };

// Sharks and octopuses are not killable with a diving knife, and pretending otherwise
// would cheapen both. They react instead — the swing registers as a threat, not damage.
export function slash(pos, fwd, range = 3.4) {
  const r2 = range * range;

  let best = null, bd = 1e9;
  if (activeZone === 2) {
    for (let i = 0; i < squids.length; i++) {
      const Q = squids[i];
      if (Q.dead) continue;
      _k1.copy(Q.pos).sub(pos);
      const d2 = _k1.lengthSq();
      // generous by the squid's own radius: the blade hits the animal, not its origin
      const reach = range + Q.size * 0.35;
      if (d2 > reach * reach) continue;
      const d = Math.sqrt(d2) + 1e-5;
      if (_k1.dot(fwd) / d < SLASH_COS) continue;
      if (d2 < bd) { bd = d2; best = Q; }
    }
  }

  if (best) {
    slashResult.killed = 'squid';
    slashResult.at.copy(best.pos);
    killSquidAt(best, best.pos);
    spawnSac(slashResult.at);
    return slashResult;
  }

  // ---- misses that still mean something ----
  let spooked = false;
  for (let i = 0; i < sharks.length; i++) {
    const S = sharks[i];
    if (S.cfg.zi !== activeZone) continue;
    // measured against the flank, generously: a blade anywhere near this much animal
    const reach = range + S.cfg.size * 0.5;
    _k1.copy(S.pos).sub(pos);
    if (_k1.lengthSq() > reach * reach) continue;
    if (S.state !== 'flee') {
      sharkSetState(S, 'flee');
      S.arousal = 0; S.cool = rng(SH.coolMax, SH.coolMax * 1.5);
      S.bit = true; S.blinded = 0.7;    // borrow the hard peel-away read
      spooked = true;
    }
  }
  for (let i = 0; i < octos.length; i++) {
    const O = octos[i];
    if (O.zi !== activeZone) continue;
    if (O.pos.distanceToSquared(pos) > (range + 2.2) * (range + 2.2)) continue;
    if (O.state === 'flee' || O.state === 'return') continue;
    // a knife on the hoarder: it drops the lantern where it sits and goes
    if (lantern.stolen && lantern.carried && lantern.by === O) dropLantern(O.pos, true);
    // emergency jet: ink first, then gone. Same escape the grab ends on, only faster.
    _k2.copy(O.pos).sub(pos);
    if (_k2.lengthSq() < 1e-4) _k2.set(1, 0, 0.3);
    _k2.normalize();
    spawnInk(O.pos, _k2, 34, O.zi, 0.9, 1.25, 0.9, 1.05);
    O.jet.copy(_k2).multiplyScalar(15).setY(4.5);
    octSet(O, 'flee');
    spooked = true;
  }
  // A spook is not a kill: game.js only reacts to a returned object, and the animal
  // getting out of the way is the whole feedback the player needs.
  void spooked;
  return null;
}

// Vents a carried sac: a diver-sized cloud, roughly double the octopus puff and
// lasting about twice as long, plus the behaviour volume the shark tests against.
export function deployInk(pos) {
  if (!pos) return false;
  const zi = activeZone < 0 ? 0 : activeZone;
  _k3.set(0, -0.25, 0);      // vented downward-ish and left to billow in place
  spawnInk(pos, _k3, CL.n, zi, 1.6, 0.55, 1.4, 1.25);
  spawnCloud(pos);
  return true;
}
