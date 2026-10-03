// MHOR, THE HUNTER — zone 2's sleeper (roadmap/three-sleepers.md, spec §2).
// A squid-like colossus: a furnace-red torpedo mantle ~36 u long with a fin running each
// side of its tail, great eyes, eight arms and two hunting tentacles with clubs, rows of
// photophores that pulse when he hunts. He is NOT in the zone. The zone is cold: its
// tallest black smoker, THE LAST FURNACE, is dead, with cold stumps round it. Feeding the
// furnace bitumen relights it — and the field wakes: a warm pocket where the air comes
// easy (the biggest practical reward in the game at the depth the hose is the leash).
// Mhor hunts heat. A little after the fire takes, photophores come up out of the black.
//
// He never stops moving: he circles the diver out in the dark, then STRIKES — turns and
// drives through him arms-first, tentacles shooting out. A hit throws Sal and tears the
// dress. Ink (Q) inside his line breaks the strike. His weakness is the furnace: a strike
// that runs through the flare blinds him; he stalls in the glow, stunned, sinking, and
// that is when his wards (on the mantle, kept by his squid as zone 2 always was) can be
// reached. Calmed, he sinks back into the deep; the furnace burns on.
import * as THREE from 'three';
import { scene, camera, renderer, envTexDeep as envTex } from '../../core.js';
import { V3, clamp, lerp } from '../../lib/math.js';
import { seededRand, makeGlow } from '../../lib/textures.js';
import * as K from './hoarderGeo.js';
import { registerPaint } from '../../lib/paint.js';
import { terrainH } from '../../world/terrain.js';
import { setWardTargets, wardGuardCount } from '../../world/predators.js';
import { riftPos, WORLD_R } from '../../config.js';
import { survival } from '../../systems/survival.js';
import {
  setLive, SIGIL_POOL_N, ensureSigilPool, sigilPool, makeWard, wardIdle, wardLitPose, wardTouch, wardFlashes, makeEmbers
} from './common.js';
import { loadSculpted, assetTextures, assetGeos } from '../../lib/assets.js';
import { lendVentLight } from '../../world/vents.js';

// THE SCULPT (tools/blender pipeline; hunterSculpt.js has the design). THE SPLIT:
//   the MANTLE is one rigid sculpt (50k tris, 2048 bake, photophores in the ORM's blue);
//   the jet still moves it in the vertex shader — the contraction scales xy by a function
//   of z, which holds for any mesh in the lathe's frame, so the wards (placed by the same
//   curve) still ride the skin. The FIN is a rigid sculpt the undulation still moves in the
//   vertex shader: its wave coordinates (out across the fin, along the root) are computed
//   from position at install (`fuv`), since its atlas UVs are charts, not a grid. The CLUB
//   rides the tentacle tip as before. The eight arms and two tentacles are verlet chains
//   rebuilt every frame (57 x 21 tubes): they keep that and get TILEABLE STRIPS, the arm's
//   u keyed to its sucker stations, the tentacle's conformal. One sucker, instanced 224x.
let SCULPT = null, SC = null;
function sculpt() {
  if (!SCULPT) { SCULPT = loadSculpted('assets/sleepers/hunter/', 'hunter'); SCULPT.then(a => { SC = a; }); }
  return SCULPT;
}
if (typeof window !== 'undefined') setTimeout(sculpt, 3500);

const TAU = Math.PI * 2;
const smooth = THREE.MathUtils.smoothstep;
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const UP = V3(0, 1, 0);
// ---- MOTION (anim-sleepers) ----------------------------------------------------------
// Mhor swims like a squid, not a torpedo on a rail: a JET cycle (the mantle contracts, he
// surges, then coasts on drag while it refills - same mean speed as the old constant one),
// fins that undulate as a travelling wave in the vertex shader, arms that are verlet
// chains pulled toward a pose (so they trail, lag in a turn, bunch on the pulse and flare
// into a basket before a hit), tentacles that fire ballistically at the diver and snap
// back, a body that BANKS into its turns (up leans toward the centre of the turn), and a
// stun that convulses and then goes limp (arms hang under gravity, the body lolls).
const JET_K = 0.6;                                     // coast drag (1/s)
const EVH = { sigilLit: 0, calmed: false, lightDrain: 0, slam: false, remaining: 0, msg: null, woke: false, warm: false };
function sprH(o, target, w, z, dt) {
  o.v = (o.v + w * w * dt * (target - o.x)) / (1 + 2 * z * w * dt + w * w * dt * dt);
  o.x += o.v * dt;
  return o.x;
}
const nzH = (t, s) => 0.6 * Math.sin(t * 1.13 + s * 1.7) * Math.sin(t * 0.71 + s * 3.1) + 0.4 * Math.sin(t * 2.37 + s * 5.3);
const _acc = V3(), _up = V3(), _bx = V3(), _by = V3(), _tv = V3(), _fp = V3(), _g = V3();
const ML_OF_SIZE = 3.6, NA = 10, RINGS = 56, RADIAL = 20, SUCK = 14;
const FEED_COST = 2, FEED_R = 5, POCKET_R = 28, FLARE_R = 22;
const _a = V3(), _b = V3(), _c = V3(), _d = V3(), _t = V3(), _p = V3(), _f = V3(), _r = V3(), _w = V3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = V3(), _z = V3(0, 0, 1), _y = V3(0, 1, 0), _in = V3(), _sd = V3(), _dn = V3(0.3, -1, 0.2).normalize();
// HIS LIGHT IS COLD (encounter pass). The thing that hunts heat carries none: his
// photophores are a pale sea-green phosphor against the furnace's orange and Sal's lamp,
// so at range the eye separates him from every warm light in the zone. Never cyan-neon:
// desaturated, and most of it is the water's own tint on a near-white.
const PHOTO = 0xb4d8c4, PHOTO_R = 0.71, PHOTO_G = 0.85, PHOTO_B = 0.77, FIRE = 0xff6a26, WARD_COL = 0xffe8a8;
// the LIGHT his body throws is warmer than the lens colour: the water eats red first, so a
// source already sea-green arrives cyan (neon) in the haze a few units out; this one
// arrives as the pale green of the lenses
const PHOTO_LIGHT = 0xcce8b0;
const FIRE_OP = [0.5, 0.16, 0.07, 0.03];
const CA = new Float32Array(RADIAL + 1), SA = new Float32Array(RADIAL + 1);
for (let j = 0; j <= RADIAL; j++) { const an = (j % RADIAL) / RADIAL * TAU; CA[j] = Math.cos(an); SA[j] = Math.sin(an); }

// ---- geometry -------------------------------------------------------------------------
// polish-sleepers2 (2026-09-25): "a smooth torpedo with a hex-looking cross-section, plain
// tube arms, sphere clubs". Now: a 160 x 72 lathe (round at any range), a float-height hide
// bake (chromatophore sacs, relief, a lateral line with its pores, LENSED photophores in two
// rows down each flank and a ventral scatter), fins as veined translucent membranes, sucker
// rows on the arms' oral faces, clubs as spindles with a hook ring and a sucker palm, great
// wet eyes (gold ring, black pupil), and the furnace a black smoker with a crust, flanges,
// a glowing throat and a heat shimmer. Bake kit shared with Orune (hoarderGeo.js).
//
// The mantle along +Z (0 = head end at the arms, L at the tail tip), lathed: a head bulb,
// a waist, the long barrel, the fin-bearing taper. Unit: mantle length 1.
const prof = s => {
  const head = 0.075 * Math.exp(-Math.pow((s - 0.06) / 0.07, 2));
  const barrel = 0.095 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05 + 0.02)), 0.55);
  return Math.max(0.004, Math.max(head, barrel) * (1 - 0.85 * sst(0.70, 1.0, s)) + 0.004);
};
const EYE_L = [0.062, 0.015, 0.075];
function mantleGeo(rows = 160, radial = 72) {
  const pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const s = i / rows, r = prof(s);
    for (let j = 0; j <= radial; j++) {
      const a = (j % radial) / radial * TAU, ca = Math.cos(a), sa = Math.sin(a);
      // a round section, a touch deeper than wide; the gladius a faint dorsal line
      let x = ca * r * 1.04, y = sa * r * (1 + 0.012 * Math.exp(-((ca / 0.12) ** 2)) * (sa > 0 ? 1 : 0));
      // the eye orbits: a raised rim round each great eye on the head bulb
      for (const sd of [-1, 1]) {
        const dx = x - EYE_L[0] * sd, dy = y - EYE_L[1], dz = s - EYE_L[2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) / 0.045;
        const k = 0.010 * Math.exp(-(((d - 1.08) / 0.16) ** 2));
        x += sd * k * Math.abs(ca); y += k * sa * 0.5;
      }
      pos.push(x, y, s);
      uv.push(s * 4, j / radial);
      const belly = sst(0.2, -0.9, sa), dors = sst(0.3, 0.95, sa);
      col.push(0.95 + 0.45 * belly - 0.12 * dors, 0.95 + 0.28 * belly - 0.08 * dors, 0.95 + 0.24 * belly - 0.06 * dors);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.prof = prof;
  return g;
}
// One fin: a membrane grid over the old outline (a quadratic from the root at 0.62 out to
// the tip at 0.97, back in at 0.99), +X side. UV: u = out across the fin (1 at the edge),
// v = along the root — the vein bake's frame.
function finGeo(rows = 36, cols = 14) {
  const Q = [];
  for (let k = 0; k <= 64; k++) { const t = k / 64, m = 1 - t; Q.push([2 * m * t * 0.14 + t * t * 0.10, m * m * 0.62 + 2 * m * t * 0.80 + t * t * 0.97]); }
  const width = z => { if (z >= 0.97) return 0.10 * (0.99 - z) / 0.02; for (let k = 1; k < Q.length; k++) if (Q[k][1] >= z) { const f = (z - Q[k - 1][1]) / (Q[k][1] - Q[k - 1][1]); return Q[k - 1][0] + (Q[k][0] - Q[k - 1][0]) * f; } return 0; };
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const v = i / rows, z = 0.62 + 0.37 * v, w = Math.max(0.002, width(Math.min(0.99, z)));
    for (let j = 0; j <= cols; j++) { const u = j / cols; pos.push(u * w, 0.004 * Math.sin(u * Math.PI) * (1 - u), z); uv.push(u, v); }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const a = i * (cols + 1) + j, b = a + cols + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// Fin membrane maps: branching veins running out and back from the root, a darker
// muscular root, a paler thin edge; veins raised in the normal map.
let _fin = null;
function finMaps(S = 256) {
  if (_fin) return _fin;
  const { A: TA, B: TB } = K.NT(), alb = new Uint8Array(S * S * 4), nrm = new Uint8Array(S * S * 4), Hf = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S, v = (y + 0.5) / S, i = y * S + x, j = i * 4;
    const warp = (K.nt(TA, u * 2, v * 3) - 0.5) * 0.12;
    // radiating ribs from the root, sweeping back, tapering to the edge; finer branches
    // appear between them past mid-fin
    const q = v - u * 0.40 + warp * 0.4;
    const d1 = Math.abs(((q * 10) % 1 + 1) % 1 - 0.5), d2 = Math.abs(((q * 20 + 0.5 + 0.08 * Math.sin(u * 9)) % 1 + 1) % 1 - 0.5);
    const vein = (1 - sst(0.0, 0.035 + 0.09 * (1 - u), d1)) * (1 - 0.45 * u) + (1 - sst(0.0, 0.05, d2)) * sst(0.4, 0.75, u) * 0.45;
    const root = 1 - sst(0.0, 0.25, u), edge = sst(0.6, 1.0, u), mot = K.nt(TB, u * 6, v * 10);
    Hf[i] = 0.004 * vein + 0.002 * root + 0.0006 * (mot - 0.5);
    const c = [0.50 - 0.16 * vein + 0.10 * edge, 0.15 - 0.07 * vein + 0.07 * edge, 0.10 - 0.05 * vein + 0.06 * edge].map(k => k * (0.85 + 0.3 * mot) * (1 - 0.35 * root));
    for (let k = 0; k < 3; k++) alb[j + k] = Math.min(255, c[k] * 255);
    alb[j + 3] = 255;
  }
  K.normalsInto(nrm, Hf, S, S, 1, false);
  _fin = { map: K.dataTex(alb, S, S, true), normalMap: K.dataTex(nrm, S, S, false) };
  for (const t of [_fin.map, _fin.normalMap]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return _fin;
}
// The membrane shader: light passes through the thin outer fin (a warm scatter scaled by
// what the surface receives, so never a glow in the dark), and the veins stay opaque.
function membrane(m, U, fuv = false) {
  // fuv: the sculpted fin carries its wave coordinates in their own attribute (its uv is an
  // atlas chart); the procedural fin's uv IS that grid
  const W = fuv ? 'fuv' : 'uv';
  m.customProgramCacheKey = () => 'abyssa-mhor-fin' + (fuv ? '-s' : '');
  m.onBeforeCompile = sh => {
    // the fin undulates: a wave running from the fin's front root to its tail tip, growing
    // toward the free edge; the normal tilts with the wave's slope
    sh.uniforms.uFin = U.uFin;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uFin;\nvarying vec2 vFuv;' + (fuv ? '\nattribute vec2 fuv;' : ''))
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vFuv = ${W};
        float fnU = pow(${W}.x, 1.3), fnA = ${W}.y * 7.54 - uFin.x;
        objectNormal = normalize(objectNormal + vec3(0.0, 0.0, -uFin.y * fnU * cos(fnA) * 20.4) * sign(objectNormal.y));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.y += uFin.y * fnU * sin(fnA) + uFin.z * ${W}.x * ${W}.x;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vFuv;');
    // THE FIN'S GLOW IS THE BODY'S LIGHT SEEN THROUGH IT, not a lamp in the membrane.
    // It used to be a flat, unmapped emissive over the whole sheet plus a 1.5x boost at the
    // thin outer edge: at a hunting pulse (ph up to 1) the membrane was an orange panel
    // bright enough that ACES rolled it to white, and seen from below — where the mantle
    // no longer hides the fin — it flashed as a blank white card. Measured: the emissive
    // was 75-80% of the fin's on-screen value. Now the photophore light enters at the
    // ROOT (where the flank rows are) and dies out across the fin, and the veins, which
    // are muscle, block it; the edge gets none. Same uniform, same pulse, same program.
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
      {
        float fnRoot = 1.0 - smoothstep(0.02, 0.55, vFuv.x);
        float fnMem = smoothstep(0.05, 0.16, diffuseColor.r);
        totalEmissiveRadiance *= fnRoot * fnRoot * (0.25 + 0.75 * fnMem);
      }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', /* glsl */`{
        float fnThin = smoothstep(0.35, 1.0, vFuv.x);
        vec3 fnLit = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
        vec3 fnIrr = fnLit / max(diffuseColor.rgb, vec3(0.08));
        float fnV = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        outgoingLight += fnThin * vec3(0.95, 0.30, 0.16) * fnIrr * (0.20 + 0.45 * fnV) * clamp(diffuseColor.r * 3.0, 0.0, 1.0);
      }
      #include <opaque_fragment>`);
  };
  return m;
}
// THE HIDE (1024^2 over the mantle UV: u = 1/4 of the body length, v = once round it; the
// cell grids are anisotropic so cells come out square on the body). Rows of photophores sit
// on the two flanks (v = 0, 0.5) as LENSES: a clear dome, a dark rim, a bright core and a
// soft halo in the emissive map; a ventral scatter; the lateral line down each flank.
let _hide = null;
function hideMaps(S = 1024) {
  if (_hide) return _hide;
  const t0 = performance.now();
  const { A: TA, B: TB, C: TC } = K.NT();
  const chrom = K.cellGrid(44, 104, 0x40FF, 0.45), rel = K.cellGrid(20, 48, 0x40F1), ven = K.cellGrid(14, 34, 0x40F7, 0.5);
  const Hf = new Float32Array(S * S), alb = new Uint8Array(S * S * 4), rgh = new Uint8Array(S * S * 4), emi = new Uint8Array(S * S * 4), nrm = new Uint8Array(S * S * 4);
  const BASE = [0.44, 0.12, 0.07], DARK = [0.20, 0.045, 0.04], SAC = [[0.14, 0.03, 0.03], [0.50, 0.17, 0.05], [0.30, 0.06, 0.08]], LENS = [0.62, 0.56, 0.50], RIM = [0.10, 0.03, 0.03];
  const vr = {}, oc = { id: 0, d: 0 }, ov = { id: 0, d: 0 };
  const own = (G, u, v, out) => {
    const x = u * G.nx, y = v * G.ny, ix = Math.floor(x), iy = Math.floor(y);
    const c = (((iy % G.ny) + G.ny) % G.ny) * G.nx + (((ix % G.nx) + G.nx) % G.nx), dx = x - ix - G.px[c], dy = (y - iy - G.py[c]);
    out.id = c; out.d = Math.sqrt(dx * dx + dy * dy); return out;
  };
  const ROWS = [0.035, 0.965, 0.465, 0.535], NU = 12, LR = 0.0065;          // lens radius in u units
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S, dors = sst(0.10, 0.25, v) * (1 - sst(0.25, 0.40, v));
    const flank = Math.min(Math.abs(v - 0), Math.abs(v - 1), Math.abs(v - 0.5));
    const ventral = sst(0.58, 0.64, v) * (1 - sst(0.86, 0.92, v));
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, i = y * S + x, j = i * 4;
      const mot = K.nt(TA, u * 3, v * 7), mot2 = K.nt(TB, u * 8, v * 19), grain = K.nt(TC, u * 64, v * 150);
      own(chrom, u, v, oc);
      const ct = chrom.t[oc.id], expd = 0.10 + 0.34 * Math.min(1, 0.2 + 0.9 * sst(0.3, 0.8, mot) + 0.3 * (ct - 0.5) + 0.4 * dors);
      const sac = 1 - sst(expd * 0.7, expd, oc.d), sq = chrom.q[oc.id], sc = sq < 0.6 ? SAC[0] : sq < 0.9 ? SAC[1] : SAC[2];
      K.voro(rel, u, v, vr);
      const groove = 1 - sst(0.0, 0.08, vr.f2 - vr.f1);
      // the lateral line: a shallow groove down the flank, with a pore every ~1/48
      const ll = 1 - sst(0.0, 0.0022, Math.abs(flank - 0.012)), pore = ll * (1 - sst(0.0, 0.3, Math.abs(((u * 48) % 1) - 0.5)));
      // photophores: the flank rows (staggered) and the ventral scatter
      let ld = 9;
      for (let r = 0; r < 4; r++) {
        const du = Math.abs((((u * NU + (r & 1) * 0.5) % 1) + 1) % 1 - 0.5) / NU, dv = Math.abs(v - ROWS[r]) * 2.33;
        const d = Math.hypot(du, dv) / LR; if (d < ld) ld = d;
      }
      if (ventral > 0) { own(ven, u, v, ov); if (ven.t[ov.id] < 0.4) { const d = ov.d / 0.16; if (d < ld) ld = d; } }
      const lens = 1 - sst(0.8, 1.0, ld), lcore = 1 - sst(0.0, 0.45, ld), halo = Math.exp(-(ld / 2.4) * (ld / 2.4)), lrim = sst(0.85, 1.0, ld) * (1 - sst(1.0, 1.35, ld));
      Hf[i] = 0.0003 * sac - 0.0005 * groove - 0.0009 * ll + 0.0004 * pore + 0.0003 * (grain - 0.5) + 0.0016 * lens * Math.sqrt(Math.max(0, 1 - ld * ld)) + 0.0005 * lrim;
      for (let k = 0; k < 3; k++) {
        let c = BASE[k] + (DARK[k] - BASE[k]) * (0.35 * sst(0.3, 0.9, mot) + 0.6 * dors);
        c *= 0.85 + 0.3 * mot2;
        c += (sc[k] - c) * sac * 0.7;
        c *= (1 - 0.18 * groove) * (0.92 + 0.16 * grain) * (1 - 0.3 * ll);
        c += (0.55 - c) * pore * 0.35;
        c += (LENS[k] - c) * lens * 0.6;
        c += (RIM[k] - c) * lrim * 0.7;
        alb[j + k] = Math.min(255, Math.max(0, c * 255));
      }
      alb[j + 3] = 255;
      const r = 0.34 - 0.06 * groove - 0.2 * lens + 0.05 * (grain - 0.5) + 0.03 * sac;
      rgh[j] = 0; rgh[j + 1] = Math.min(255, Math.max(0.1, r) * 255); rgh[j + 2] = 0; rgh[j + 3] = 255;
      const e = Math.min(1, lcore + 0.35 * halo);
      emi[j] = emi[j + 1] = emi[j + 2] = e * 255; emi[j + 3] = 255;
    }
  }
  K.normalsInto(nrm, Hf, S, S, 1.0, true);
  _hide = { map: K.dataTex(alb, S, S, true), normalMap: K.dataTex(nrm, S, S, false), roughnessMap: K.dataTex(rgh, S, S, false), emissiveMap: K.dataTex(emi, S, S, true) };
  _hide.ms = performance.now() - t0;
  return _hide;
}
// The great eye (sculpt pass: "huge dark eyes with a faint photophore ring"): a black pupil
// filling most of it with a dim tapetal sheen, a near-black iris shot with faint silver
// fibres, a thin tarnished-brass limbal ring, and outside it a ring of small photophores.
let _meye = null;
function eyeMaps(S = 256) {
  if (_meye) return _meye;
  const { A: TA, B: TB } = K.NT(), alb = new Uint8Array(S * S * 4), emi = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const px = (x + 0.5) / S * 2 - 1, py = (y + 0.5) / S * 2 - 1, r = Math.hypot(px * 0.92, py), th = Math.atan2(py, px), j = (y * S + x) * 4;
    const f = 0.75 + 0.5 * K.nt(TB, th / TAU * 12, r * 4);
    let c, e;
    if (r < 0.60) { c = [0.004, 0.004, 0.006]; e = 0.22 * (1 - sst(0.15, 0.60, r)) + 0.03; }
    else if (r < 0.82) { const m = 0.5 + 0.5 * K.nt(TA, th / TAU * 26, r * 7); c = [0.05 * m + 0.02, 0.045 * m + 0.02, 0.05 * m + 0.025].map(q => q * f); e = 0.04; }
    else if (r < 0.87) { const k = Math.sin((r - 0.82) / 0.05 * Math.PI); c = [0.42 * k * f, 0.32 * k * f, 0.13 * k * f]; e = 0.12 * k; }
    else {
      c = [0.06, 0.02, 0.02];
      const a = ((th / TAU * 16) % 1 + 1) % 1, d = Math.hypot((a - 0.5) * TAU * 0.93 / 16 * 9, (r - 0.93) * 9);
      const dot = 1 - sst(0.10, 0.22, d);
      c = c.map((q, i) => q + ([0.55, 0.50, 0.45][i] - q) * dot * 0.6); e = 0.9 * dot;
    }
    for (let k = 0; k < 3; k++) { alb[j + k] = Math.min(255, c[k] * 255); emi[j + k] = Math.min(255, e * 255); }
    alb[j + 3] = emi[j + 3] = 255;
  }
  _meye = { map: K.dataTex(alb, S, S, true), emissiveMap: K.dataTex(emi, S, S, true) };
  for (const t of [_meye.map, _meye.emissiveMap]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return _meye;
}
function tubeGeo() {
  const g = new THREE.BufferGeometry(), nv = (RINGS + 1) * (RADIAL + 1);
  const uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3), idx = [];
  for (let i = 0; i <= RINGS; i++) for (let j = 0; j <= RADIAL; j++) {
    const k = i * (RADIAL + 1) + j, a = (j % RADIAL) / RADIAL * TAU;
    uv[k * 2] = i / RINGS * 5; uv[k * 2 + 1] = j / RADIAL;
    const pale = sst(-0.2, -0.8, Math.cos(a));                                 // the oral face (-U) is pale
    col[k * 3] = 0.9 + 0.45 * pale; col[k * 3 + 1] = 0.9 + 0.25 * pale; col[k * 3 + 2] = 0.9 + 0.22 * pale;
  }
  for (let i = 0; i < RINGS; i++) for (let j = 0; j < RADIAL; j++) {
    const a = i * (RADIAL + 1) + j, b = a + RADIAL + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return g;
}
// The tentacle club (unit: half-length 1 along +Z): a flattened spindle (the manus), a
// ring of ten curved horn HOOKS round its middle, and a palm of small suckers on its -Y
// face. Vertex colour marks the horn and the pale palm.
function clubGeo() {
  const P = [];
  for (let k = 0; k <= 20; k++) { const t = k / 20, z = -1 + 2 * t; P.push(new THREE.Vector2(Math.max(0.001, 0.36 * Math.pow(Math.sin(Math.PI * t), 0.8) * (1 - 0.25 * t)), z)); }
  const body = new THREE.LatheGeometry(P, 24);
  body.rotateX(Math.PI / 2);                                        // lathe axis Y -> Z
  body.scale(1, 0.48, 1);
  const parts = [K.paint(body, (x, y, z, c) => { const palm = sst(0.0, -0.1, y); c[0] = 0.95 + 0.4 * palm; c[1] = 0.95 + 0.25 * palm; c[2] = 0.95 + 0.22 * palm; })];
  for (let k = 0; k < 10; k++) {
    const a = k / 10 * TAU, h = new THREE.ConeGeometry(0.05, 0.28, 8, 3);
    const p = h.attributes.position;
    for (let i = 0; i < p.count; i++) { const yy = p.getY(i) + 0.14; p.setZ(i, p.getZ(i) - 0.35 * yy * yy); }   // the hook's curve
    h.translate(0, 0.14, 0);
    h.rotateZ(-Math.PI / 2 + 0); h.rotateX(0); h.rotateZ(a);
    h.scale(1, 0.55, 1);
    h.translate(Math.cos(a) * 0.30, Math.sin(a) * 0.30 * 0.48, -0.05 + 0.12 * Math.sin(k * 2.1));
    parts.push(K.paint(h, (x, y, z, c) => { c[0] = 0.10; c[1] = 0.07; c[2] = 0.05; }));
  }
  for (let k = 0; k < 14; k++) {
    const sg = K.suckerRaw(10), f = (k % 7) / 6, side = k < 7 ? -1 : 1, sc = 0.07 * (1 - 0.4 * Math.abs(f - 0.5));
    sg.scale(sc, sc, sc); sg.rotateX(Math.PI); sg.translate(side * 0.11, -0.13, -0.75 + 1.5 * f + side * 0.05);
    parts.push(sg);
  }
  return K.mergeClean(parts);
}
// A black smoker, lathed, lumpy and flanged: `h` tall, base radius `r`. Vertex colour
// carries vents.js's palette (olive sediment low, dark sulfide, rust streaks, pale crust
// near the throat); the bore is recessed so the fire sits down in it.
const C_OLIVE = [0.29, 0.29, 0.21], C_DARK = [0.14, 0.125, 0.10], C_RUST = [0.43, 0.25, 0.15], C_PALE = [0.73, 0.67, 0.53], C_COLD = [0.17, 0.18, 0.16];
function chimneyGeo(h, r, seed, dead = false) {
  const rnd = seededRand(seed), P = [], NR = 40, fl = [0.3 + 0.2 * rnd(), 0.55 + 0.15 * rnd(), 0.78 + 0.1 * rnd()];
  for (let k = 0; k <= NR; k++) {
    const s = k / NR;
    let rr = r * (1 - 0.62 * s) * (0.9 + 0.2 * rnd()) + r * 0.08 * sst(0.9, 0.97, s) + r * 0.35 * Math.pow(1 - s, 6);
    for (const f of fl) rr += r * 0.09 * Math.exp(-(((s - f) / 0.02) ** 2));        // flanges
    P.push(new THREE.Vector2(rr, s * h));
  }
  P.push(new THREE.Vector2(r * 0.30, h * 0.995), new THREE.Vector2(r * 0.22, h * 0.93), new THREE.Vector2(r * 0.12, h * 0.85));   // the bore
  const g = new THREE.LatheGeometry(P, 44);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = p.getY(i), ang = Math.atan2(z, x), s = y / h;
    const lump = K.fbm(ang / TAU * 5 + seed * 0.001, s * 6, 0, 4), nod = K.fbm(ang / TAU * 16, s * 24, 1, 5);
    const k = 1 + 0.04 * Math.sin(y * 1.7 + ang * 3) + 0.30 * (lump - 0.5) + 0.10 * sst(0.55, 0.8, nod);
    p.setX(i, x * k); p.setZ(i, z * k);
    const streak = K.fbm(ang / TAU * 7 + s * 3, s * 4, 1, 4), bore = y > h * 0.9 && Math.hypot(x, z) < r * 0.31 ? 1 : 0;
    const c = [];
    for (let q = 0; q < 3; q++) {
      let v = C_DARK[q] + ((dead ? C_COLD[q] : C_OLIVE[q]) - C_DARK[q]) * Math.max(0, 1 - s * 2.1);
      v += (C_RUST[q] - v) * Math.max(0, Math.min(1, (streak - 0.42) * 2.2)) * 0.6;
      if (!dead) v += (C_PALE[q] - v) * sst(0.72, 1.0, s) * 0.55 * sst(0.4, 0.7, nod);
      v *= 0.8 + 0.35 * nod;
      if (bore) v *= 0.25;
      c.push(v);
    }
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
// Crust maps for the smoker (lathe UV: u round, v up): nodular sulfide relief, and the FIRE
// as an emissive mask — the throat, and glowing cracks webbed through the top third.
let _crust = null;
function crustMaps(S = 256) {
  if (_crust) return _crust;
  const { A: TA, B: TB } = K.NT(), cr = K.cellGrid(12, 20, 0xC2057), vc = {};
  const nrm = new Uint8Array(S * S * 4), emi = new Uint8Array(S * S * 4), Hf = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S, v = (y + 0.5) / S, i = y * S + x, j = i * 4;
    K.voro(cr, u, v, vc);
    const crack = 1 - sst(0.0, 0.06, vc.f2 - vc.f1), nod = K.nt(TA, u * 8, v * 8);
    Hf[i] = 0.01 * sst(0.4, 0.8, nod) + 0.004 * K.nt(TB, u * 32, v * 32) - 0.006 * crack;
    const fire = Math.max(sst(0.93, 0.975, v), crack * sst(0.55, 0.9, v) * (0.5 + 0.5 * K.nt(TB, u * 4, v * 4)));
    emi[j] = fire * 255; emi[j + 1] = fire * 200; emi[j + 2] = fire * 150; emi[j + 3] = 255;
  }
  K.normalsInto(nrm, Hf, S, S, 1, true);
  _crust = { normalMap: K.dataTex(nrm, S, S, false), emissiveMap: K.dataTex(emi, S, S, true) };
  return _crust;
}
// A heat shimmer strip for above the throat: soft rising streaks, alpha only.
let _shim = null;
function shimmerTex() {
  if (_shim) return _shim;
  const W = 64, H = 256, d = new Uint8Array(W * H * 4), { A: TA } = K.NT();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H, j = (y * W + x) * 4;
    const band = Math.sin(Math.PI * u) ** 2, s = K.nt(TA, u * 4 + Math.sin(v * TAU * 2) * 0.1, v * 6);
    const a = band * sst(0.45, 0.8, s) * 0.7;
    d[j] = 255; d[j + 1] = 190; d[j + 2] = 140; d[j + 3] = a * 255;
  }
  _shim = K.dataTex(d, W, H, true);
  _shim.wrapS = THREE.ClampToEdgeWrapping;
  return _shim;
}

// ---- build ----------------------------------------------------------------------------
export function makeHunter(idx, cfg) {
  let c = cfg;
  if (c.nSigils > SIGIL_POOL_N) c = Object.assign({}, c, { nSigils: SIGIL_POOL_N });
  ensureSigilPool();
  const ML = c.size * ML_OF_SIZE;
  const grp = new THREE.Group(), body = new THREE.Group();
  body.scale.setScalar(ML);
  grp.add(body);
  const L = {
    ...c, idx, R: ML * 0.1, ML, size: c.size, grp, body, t: 0, agitation: 0, calmed: false, calmT: 0,
    sonarWards: false, guardWards: true, reveal: 0, rang: false, hinted: false, pendingMsg: null,
    reach: 6, collR: ML * 0.09, flare: 0, dormant: true,
    state: 'absent', stT: 0, pos: V3(0, -9999, 0), vel: V3(), fwd: V3(0, 0, 1), head: V3(), spine: [V3(), V3(), V3(), V3(), V3()],
    sigils: [], arms: [], stun: 0, pulse: 0, orbitA: 0, strikeFrom: V3(), strikeTo: V3(), _pd: 1e9,
    sigilStyle: true, stage: null, photo: 0, fireL: 0,
    suckK: 0.19, sculpted: false, spd: 0, jetPh: 0, contract: 0, inflate: 0, spread: 1, finPh: 0, accS: V3(), fwdPrev: V3(0, 0, 1), stunT: 0, loll: { x: 0, v: 0 }, tip: [{ x: 0, v: 0 }, { x: 0, v: 0 }], armsInit: false
  };

  // ---- the field: the last furnace, cold stumps, scorch ----
  const rp = riftPos(idx), awayRift = V3(-rp.x, 0, -rp.z).normalize();
  const F = V3(awayRift.x * WORLD_R * 0.30, 0, awayRift.z * WORLD_R * 0.30);
  F.y = terrainH(F.x, F.z, idx);
  L.furnace = { pos: F, lit: false, heat: 0, top: V3(F.x, F.y + 28, F.z), found: false, stumps: [], stumpFound: false };
  const crust = crustMaps();
  const smokerMat = registerPaint(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.92, metalness: 0.05, envMap: envTex, envMapIntensity: 0.2,
    normalMap: crust.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), emissive: 0xff5a14, emissiveMap: crust.emissiveMap, emissiveIntensity: 0 }));
  L.smokerMat = smokerMat;
  const furnace = new THREE.Mesh(chimneyGeo(28, 5.2, 0xF0A1), smokerMat);
  furnace.position.copy(F);
  furnace.castShadow = furnace.receiveShadow = true;
  grp.add(furnace);
  const coldMat = registerPaint(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0.05, normalMap: crust.normalMap, normalScale: new THREE.Vector2(1.2, 1.2) }));
  const rnd = seededRand(0x5700 + idx);
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * TAU + rnd(), r = 26 + rnd() * 30;
    const x = F.x + Math.cos(a) * r, z = F.z + Math.sin(a) * r, y = terrainH(x, z, idx);
    const st = new THREE.Mesh(chimneyGeo(6 + rnd() * 9, 1.8 + rnd() * 1.4, 0xC01D + k, true), coldMat);
    st.position.set(x, y, z);
    grp.add(st);
    L.furnace.stumps.push(V3(x, y, z));
  }
  // the fire: glow sprites up the throat (fog off, the vent-ember lesson) + a heat shimmer
  L.fire = [];
  for (let k = 0; k < 4; k++) {
    const gl = makeGlow(0xff7a2a, 1);
    gl.material.fog = false;
    gl.material.opacity = 0;
    gl.position.set(F.x, F.y + 28 + k * 4, F.z);
    grp.add(gl);
    L.fire.push(gl);
  }
  // heat shimmer over the throat: rising streaks scrolled up the strip (an additive sprite)
  const sht = shimmerTex().clone();
  sht.needsUpdate = true;
  L.shimmer = new THREE.Sprite(new THREE.SpriteMaterial({ map: sht, color: 0xff9a5a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  L.shimmer.position.set(F.x, F.y + 28 + 9, F.z);
  L.shimmer.scale.set(9, 20, 1);
  grp.add(L.shimmer);

  // ---- his body ----
  const bt0 = performance.now(), hide = hideMaps(), fm = finMaps(), me = eyeMaps();
  L.bakeMs = { hide: hide.ms, total: performance.now() - bt0 };            // first build pays; cached after
  L.keepTex = new Set([hide.map, hide.normalMap, hide.roughnessMap, hide.emissiveMap, fm.map, fm.normalMap, me.map, me.emissiveMap, crust.normalMap, crust.emissiveMap, shimmerTex()]);
  const skin = registerPaint(K.wetSkin(new THREE.MeshStandardMaterial({
    map: hide.map, normalMap: hide.normalMap, normalScale: new THREE.Vector2(1, 1), roughnessMap: hide.roughnessMap, vertexColors: true,
    roughness: 1.1, metalness: 0, envMap: envTex, envMapIntensity: 0.25,
    emissive: PHOTO, emissiveMap: hide.emissiveMap, emissiveIntensity: 0, side: THREE.FrontSide
  }), 'abyssa-mhor-skin', 0));
  L.skin = skin;
  const mg = mantleGeo();
  // the mantle has its own copy of the skin program with the JET in its vertex stage: the
  // barrel contracts and inflates radially, a peristaltic ripple running down it
  L.mU = { uContract: { value: new THREE.Vector3() } };
  const mskin = registerPaint(K.wetSkin(new THREE.MeshStandardMaterial({
    map: hide.map, normalMap: hide.normalMap, normalScale: new THREE.Vector2(1, 1), roughnessMap: hide.roughnessMap, vertexColors: true,
    roughness: 1.1, metalness: 0, envMap: envTex, envMapIntensity: 0.25,
    emissive: PHOTO, emissiveMap: hide.emissiveMap, emissiveIntensity: 0, side: THREE.FrontSide
  }), 'abyssa-mhor-mantle', 0));
  {
    const ob = mskin.onBeforeCompile;
    mskin.onBeforeCompile = (sh, r) => {
      ob(sh, r);
      sh.uniforms.uContract = L.mU.uContract;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uContract;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float mcK = smoothstep(0.10, 0.30, position.z) * (1.0 - smoothstep(0.78, 0.98, position.z));
          transformed.xy *= 1.0 + uContract.x * mcK + uContract.y * mcK * sin(position.z * 25.0 - uContract.z);`);
    };
  }
  L.mskin = mskin;
  const mantle = new THREE.Mesh(mg, mskin);
  mantle.castShadow = true;
  body.add(mantle);
  L.finU = { uFin: { value: new THREE.Vector3() } };
  const finMat = registerPaint(membrane(new THREE.MeshStandardMaterial({ color: 0xffffff, map: fm.map, normalMap: fm.normalMap, roughness: 0.42, metalness: 0,
    side: THREE.DoubleSide, forceSinglePass: true, transparent: false, envMap: envTex, envMapIntensity: 0.35, emissive: PHOTO, emissiveIntensity: 0 }), L.finU));
  L.finMat = finMat;
  L.fins = [];
  for (const sd of [-1, 1]) {
    const fin = new THREE.Mesh(finGeo(), finMat);
    fin.scale.x = sd;
    body.add(fin);
    L.fins.push({ fin, sd });
  }
  // eyes: huge, black, with a gold ring; eyeshine off the lantern
  const eyeMat = K.wetEye(new THREE.MeshStandardMaterial({ color: 0xffffff, map: me.map, roughness: 0.03, metalness: 0.2, envMap: envTex, envMapIntensity: 2.2,
    emissive: 0xd8c070, emissiveMap: me.emissiveMap, emissiveIntensity: 0 }));
  L.eyeMat = eyeMat;
  const eyeG = K.eyeBallGeo(0.045, 0.16);
  for (const sd of [-1, 1]) {
    const e = new THREE.Mesh(eyeG, eyeMat);
    e.position.set(EYE_L[0] * sd, EYE_L[1], EYE_L[2]);
    e.rotation.y = sd * Math.PI / 2;                                  // the iris looks out sideways
    e.scale.set(1, 1, 0.7);
    body.add(e);
  }
  // arms (8) + tentacles (2): world-space tubes rebuilt per frame
  for (let a = 0; a < NA; a++) {
    const geo = tubeGeo(), mesh = new THREE.Mesh(geo, skin);
    mesh.frustumCulled = false;
    grp.add(mesh);
    const tent = a >= 8;
    L.arms.push({
      geo, mesh, tent, ang: tent ? (a === 8 ? -0.35 : 0.35) : (a + 0.5) / 8 * TAU,
      len: ML * (tent ? 0.95 : 0.42), r0: ML * (tent ? 0.012 : 0.022), shoot: 0,
      pts: Array.from({ length: RINGS + 1 }, () => V3()), U: Array.from({ length: RINGS + 1 }, () => V3()),
      prev: Array.from({ length: RINGS + 1 }, () => V3())
    });
  }
  // tentacle clubs: flattened spindles with a ring of hooks and a sucker palm
  L.clubs = [];
  const cg = clubGeo();
  for (let k = 0; k < 2; k++) {
    const club = new THREE.Mesh(cg, skin);
    club.scale.setScalar(ML * 0.07);
    grp.add(club);
    L.clubs.push(club);
  }
  // suckers: two staggered rows on each arm's oral face, shrinking to the tip
  L.suckMat = registerPaint(new THREE.MeshStandardMaterial({ color: 0xd9a58e, vertexColors: true, roughness: 0.4, metalness: 0, envMap: envTex, envMapIntensity: 0.35 }));
  L.suckers = new THREE.InstancedMesh(K.suckerRaw(12), L.suckMat, 8 * SUCK * 2);
  L.suckers.frustumCulled = false;
  L.suckers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  L.suckers.visible = false;
  grp.add(L.suckers);
  // THE PHOTOPHORES AS POINTS (encounter pass). They were 24 soft additive sprites that
  // SWELLED with range to 5-7 u each: at hunting distance the frame showed a string of
  // orange bokeh balls and no animal. Now ~150 crisp lens points on his real rows — two
  // flank rows a side, three counter-illumination rows down the belly, a ring round each
  // eye — each sized to the lens (0.3 u), never under ~1.6 px, brightness conserved when
  // the size clamps. The bloom does the halation. They ride the jet (the same contraction
  // as the mantle shader) and are depth-tested against his own body, so the far rows are
  // eclipsed and the near rows OUTLINE his silhouette in the dark: you see the shape of
  // him drawn in cold light long before the lantern finds him.
  {
    const P = [], A = [];                                       // xyz, (phase, kind, size, seed)
    const on = (s, a, rMul, kind, sz, ph) => { const r = prof(s) * rMul; P.push(Math.cos(a) * r * 1.04, Math.sin(a) * r, s); A.push(ph, kind, sz, Math.random()); };
    for (const side of [0, Math.PI]) for (const row of [0.20, -0.14]) {
      for (let s2 = 0.15; s2 <= 0.80; s2 += 0.028) on(s2 + (row > 0 ? 0 : 0.014), side + (side ? -row : row), 1.03, 0, 1.0, s2);
    }
    for (const a of [-Math.PI / 2 - 0.42, -Math.PI / 2, -Math.PI / 2 + 0.42]) {
      for (let s2 = 0.12; s2 <= 0.84; s2 += 0.032) on(s2 + (a === -Math.PI / 2 ? 0.016 : 0), a, 1.03, 1, 0.85, s2);
    }
    for (const sd of [-1, 1]) for (let k = 0; k < 12; k++) {
      const t = k / 12 * TAU, r = 0.056;
      P.push(EYE_L[0] * sd * 1.12, EYE_L[1] + Math.sin(t) * r * 0.85, EYE_L[2] + Math.cos(t) * r); A.push(k / 12, 2, 0.7, Math.random());
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    gg.setAttribute('aP', new THREE.Float32BufferAttribute(A, 4));
    gg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0.5), 0.8);
    L.photoU = {
      uLvl: { value: new THREE.Vector4() },                     // x flank, y belly, z eye, w chase speed
      uT: { value: 0 }, uPix: { value: 900 }, uExt: { value: 0.01 }, uSize: { value: 0.42 / ML },
      uContract: L.mU.uContract, uCol: { value: new THREE.Vector3(PHOTO_R, PHOTO_G, PHOTO_B) }
    };
    L.glowMat = new THREE.ShaderMaterial({
      uniforms: L.photoU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: /* glsl */`
        attribute vec4 aP;
        uniform vec4 uLvl; uniform float uT, uPix, uExt, uSize; uniform vec3 uContract;
        varying float vI;
        void main(){
          vec3 p = position;
          // ride the jet: the mantle shader's contraction, same curve
          float mcK = smoothstep(0.10, 0.30, p.z) * (1.0 - smoothstep(0.78, 0.98, p.z));
          if (aP.y < 1.5) p.xy *= 1.0 + uContract.x * mcK + uContract.y * mcK * sin(p.z * 25.0 - uContract.z);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = max(-mv.z, 0.5);
          // world size from the body scale (column length of the model matrix)
          float ws = uSize * aP.z * length(modelMatrix[0].xyz);
          float px = ws * uPix / d;
          float ps = clamp(px, 2.2, 8.0);
          gl_PointSize = ps;
          // row levels; the flank rows carry a chase wave when he hunts
          float lv = aP.y < 0.5 ? uLvl.x * (0.55 + 0.45 * sin(uT * uLvl.w - aP.x * 38.0))
                   : aP.y < 1.5 ? uLvl.y * (0.85 + 0.15 * sin(uT * 1.3 + aP.w * 6.28))
                   : uLvl.z * (0.7 + 0.3 * sin(uT * 2.0 + aP.x * 6.28));
          // energy kept when the lens is under the clamp; the murk's own extinction, halved
          // (a point source in turbid water survives further than the flank it sits on)
          float cons = min(1.0, (px * px) / (ps * ps) * 4.0);
          vI = lv * cons * exp(-d * uExt) * (1.0 - smoothstep(170.0, 230.0, d));
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uCol;
        varying float vI;
        void main(){
          if (vI <= 0.002) discard;
          vec2 q = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(q, q);
          if (r2 > 1.0) discard;
          float a = exp(-r2 * 4.5);
          gl_FragColor = vec4(uCol * (vI * a * 3.6), 1.0);
        }`
    });
    L.glowMat.customProgramCacheKey = () => 'abyssa-mhor-photo';
    L.glow = new THREE.Points(gg, L.glowMat);
    L.glow.frustumCulled = false;
    L.glow.renderOrder = 2;
    body.add(L.glow);
  }

  // ---- wards: five on the mantle, kept by the squid (the zone-2 rule) ----
  const WS = [[0.10, 0.25], [-0.10, 0.40], [0.10, 0.55], [-0.10, 0.68], [0, 0.32]];
  for (let i = 1; i <= c.nSigils; i++) {
    const w = makeWard(L, i, 3.6);
    const [side, s] = WS[(i - 1) % WS.length];
    w.local = V3(side * 1.0, 0.085, s);                               // on the dorsal barrel
    w.local0 = w.local.clone();
    w.q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), V3(side * 0.6, 1, 0).normalize());
    L.sigils.push(w);
  }
  makeEmbers(L, c.size);
  grp.visible = true;
  body.visible = false;
  for (const A of L.arms) A.mesh.visible = false;
  for (const cl of L.clubs) cl.visible = false;

  L.rite = {
    prompt: pos => {
      if (L.furnace.lit) return null;
      if (Math.hypot(pos.x - F.x, pos.z - F.z) > FEED_R + 5.2 || pos.y > F.y + 12) return null;
      return survival.bitumen >= FEED_COST ? '[E] FEED THE FURNACE' : 'THE FURNACE IS COLD. IT WANTS BITUMEN.';
    },
    interact: pos => {
      if (L.furnace.lit || Math.hypot(pos.x - F.x, pos.z - F.z) > FEED_R + 5.2 || pos.y > F.y + 12) return null;
      if (survival.bitumen < FEED_COST) return { msg: `THE FURNACE WANTS ${FEED_COST} BITUMEN.` };
      survival.bitumen -= FEED_COST;
      L.furnace.lit = true;
      L.stT = 0;
      return { took: true, msg: 'THE FURNACE TAKES. THE FIELD WAKES — AND THE WARMTH CARRIES.' };
    }
  };
  L.lairWhere = 'IN THE COLD';
  L.cmd = (name, arg) => {
    if (name === 'stand' || name === 'wake') { if (!L.furnace.lit) { L.furnace.lit = true; L.stT = 0; } else if (L.state === 'absent') arrive(L); }
    else if (name === 'rear') { if (L.state === 'circle') startStrike(L, arg || null); }
    else if (name === 'stun') stunHim(L);
    return L.probe();
  };
  L.probe = () => ({
    kind: 'hunter', state: L.state, furnace: L.furnace.lit, heat: +L.furnace.heat.toFixed(2), stun: +L.stun.toFixed(1),
    pos: L.pos.toArray().map(v => +v.toFixed(1)), calmed: L.calmed, wards: L.sigils.map(g => ({ lit: g.lit, kept: wardGuardCount(L.sigils.indexOf(g)) }))
  });
  if (typeof window !== 'undefined') window.__sl = L;        // dev: the live sleeper object (motion probes)
  scene.add(grp);
  setLive(L);
  setWardTargets(-1, null);
  // (window.__noSculpt: dev A/B — build the procedural body and leave it)
  const want = !(typeof window !== 'undefined' && window.__noSculpt);
  if (SC && want) installSculpt(L, SC);
  else if (want) sculpt().then(a => { if (a && !L.gone) installSculpt(L, a); });
  const pd = L.onDispose;
  L.onDispose = () => { L.gone = true; if (pd) pd(); };
  return L;
}

// ---- THE SCULPT, installed in place --------------------------------------------------------
// the fin's outline (finGeo's quadratic, and hunterSculpt's): width across at z
const FINQ = (() => { const Q = []; for (let k = 0; k <= 64; k++) { const t = k / 64, m = 1 - t; Q.push([2 * m * t * 0.14 + t * t * 0.10, m * m * 0.62 + 2 * m * t * 0.80 + t * t * 0.97]); } return Q; })();
function finWidth(z) {
  if (z >= 0.97) return 0.10 * Math.max(0, 0.99 - z) / 0.02;
  for (let k = 1; k < FINQ.length; k++) if (FINQ[k][1] >= z) { const f = (z - FINQ[k - 1][1]) / (FINQ[k][1] - FINQ[k - 1][1]); return FINQ[k - 1][0] + (FINQ[k][0] - FINQ[k - 1][0]) * f; }
  return 0;
}
// the fin's wave coordinates from position (u out across it, v along its root), and the
// mirrored copy for the -X side (a negative scale would turn the tangent frame inside out)
function finFuv(g) {
  const p = g.attributes.position, n = p.count, f = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = Math.abs(p.getX(i)), z = p.getZ(i), w = Math.max(0.004, finWidth(Math.min(0.99, Math.max(0.62, z))));
    f[i * 2] = Math.min(1, Math.max(0, x / w)); f[i * 2 + 1] = Math.min(1, Math.max(0, (z - 0.62) / 0.37));
  }
  g.setAttribute('fuv', new THREE.BufferAttribute(f, 2));
  return g;
}
function mirrorX(g0) {
  const g = g0.clone();
  for (const k of ['position', 'normal']) { const a = g.attributes[k]; for (let i = 0; i < a.count; i++) a.setX(i, -a.getX(i)); }
  const t = g.attributes.tangent;
  if (t) for (let i = 0; i < t.count; i++) { t.setX(i, -t.getX(i)); t.setW(i, -t.getW(i)); }
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) { const q = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = q; }
  g.computeBoundingSphere();
  return g;
}
// hide: wet skin, photophores = the ORM's blue (the pipeline's R AO / G rough / B emissive)
function sculptHide(maps, key, extra) {
  const m = K.wetSkin(new THREE.MeshStandardMaterial(Object.assign({
    map: maps.map, normalMap: maps.normalMap, normalScale: new THREE.Vector2(1, 1), roughnessMap: maps.ormMap, aoMap: maps.ormMap,
    roughness: 1, metalness: 0, envMap: envTex, envMapIntensity: 0.25,
    emissive: PHOTO, emissiveMap: maps.ormMap, emissiveIntensity: 0
  }, extra || {})), key, 0);
  const ob = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    ob(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', THREE.ShaderChunk.emissivemap_fragment.replace('emissiveColor.rgb', 'emissiveColor.bbb * smoothstep(0.08, 0.3, emissiveColor.b)'));
  };
  return registerPaint(m);
}
// arm u keyed to the sucker stations (t = ((s - 0.16) / 0.76)^1.25 is the station index / 14,
// continued linearly past both ends); tentacle u conformal (d u = ds len / (Lu r))
function armU(s) {
  if (s < 0.16) return (s - 0.16) * 0.678;
  if (s > 0.92) return 1 + (s - 0.92) * 1.645;
  return Math.pow((s - 0.16) / 0.76, 1.25);
}
function installSculpt(L, A) {
  const g = A.geos, meta = A.meta.meta || {};
  if (!g.mantle || !g.fin || !g.club || !g.sucker || !A.maps.body || !A.maps.limbs || !A.maps.arm || !A.maps.tent || L.sculpted) return;
  L.sculpted = true;
  L.keepTex = new Set([...L.keepTex, ...assetTextures(A)]);
  L.keepGeo = assetGeos(A);
  for (const set of ['arm', 'tent']) for (const t of Object.values(A.maps[set])) if (t.wrapS !== THREE.RepeatWrapping) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; }
  const oldMats = new Set([L.skin, L.mskin, L.finMat, L.suckMat]), oldGeos = new Set();
  // THE MANTLE: the jet's contraction patched over the sculpt's hide (same curve as before)
  const mm = sculptHide(A.maps.body, 'abyssa-mhor-sculpt-mantle');
  {
    const ob = mm.onBeforeCompile;
    mm.onBeforeCompile = (sh, r) => {
      ob(sh, r);
      sh.uniforms.uContract = L.mU.uContract;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uContract;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float mcK = smoothstep(0.10, 0.30, position.z) * (1.0 - smoothstep(0.78, 0.98, position.z));
          transformed.xy *= 1.0 + uContract.x * mcK + uContract.y * mcK * sin(position.z * 25.0 - uContract.z);`);
    };
  }
  const mantle = L.body.children.find(o => o.isMesh && o.material === L.mskin);
  oldGeos.add(mantle.geometry);
  mantle.geometry = g.mantle; mantle.material = mm;
  L.mskin = mm;
  // THE FINS: ribbed, torn; the membrane program, its wave on `fuv`
  const fm = registerPaint(membrane(new THREE.MeshStandardMaterial({ color: 0xffffff, map: A.maps.limbs.map, normalMap: A.maps.limbs.normalMap, roughnessMap: A.maps.limbs.ormMap, aoMap: A.maps.limbs.ormMap,
    roughness: 1, metalness: 0, envMap: envTex, envMapIntensity: 0.35, emissive: PHOTO, emissiveIntensity: 0 }), L.finU, true));
  const finR = finFuv(g.fin), finL = finFuv(mirrorX(g.fin));
  L.keepGeo.add(finR);
  for (const f of L.fins) { oldGeos.add(f.fin.geometry); f.fin.geometry = f.sd > 0 ? finR : finL; f.fin.scale.x = 1; f.fin.material = fm; }
  L.finMat = fm;
  // ARMS and TENTACLES: the strips
  const armMat = sculptHide(A.maps.arm, 'abyssa-mhor-sculpt-limb');
  const tentMat = sculptHide(A.maps.tent, 'abyssa-mhor-sculpt-limb');
  const pairs = meta.armPairs || 7, tLu = meta.tentLu || 8;
  for (let a = 0; a < L.arms.length; a++) {
    const Ar = L.arms[a], row = RADIAL + 1, uv = new Float32Array((RINGS + 1) * row * 2);
    let u = 0;
    for (let i = 0; i <= RINGS; i++) {
      const s = i / RINGS;
      if (Ar.tent) {
        if (i > 0) { const sm = (i - 0.5) / RINGS, r = Ar.r0 * Math.pow(1 - sm, 0.7) + 0.08 + (sm > 0.85 ? Ar.r0 * 0.6 : 0); u += Ar.len * 0.6 / RINGS / (tLu * r); }
      } else u = armU(s) * 14 / pairs + ((a * 3) % pairs) / pairs;
      for (let j = 0; j <= RADIAL; j++) { const q = (i * row + j) * 2; uv[q] = u; uv[q + 1] = j / RADIAL; }
    }
    Ar.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    Ar.mesh.material = Ar.tent ? tentMat : armMat;
  }
  // THE CLUBS: the swivel hooks
  const cm = sculptHide(A.maps.limbs, 'abyssa-mhor-sculpt-limb', { envMapIntensity: 0.5 });
  for (const c of L.clubs) { oldGeos.add(c.geometry); c.geometry = g.club; c.material = cm; }
  // THE SUCKERS: stalked cups with their toothed rings
  const sm = registerPaint(new THREE.MeshStandardMaterial({ map: A.maps.sucker.map, normalMap: A.maps.sucker.normalMap, roughnessMap: A.maps.sucker.ormMap, aoMap: A.maps.sucker.ormMap,
    roughness: 1, metalness: 0, envMap: envTex, envMapIntensity: 0.4 }));
  oldGeos.add(L.suckers.geometry);
  L.suckers.geometry = g.sucker; L.suckers.material = sm; L.suckMat = sm;
  L.suckK = meta.suckK || 0.19;
  for (const q of oldGeos) q.dispose();
  for (const m of oldMats) if (m) m.dispose();
  L.skin = armMat;
  L.skinX = [tentMat, cm];
}

function arrive(L) {
  // up out of the black: below and beyond the diver's side of the field
  const F = L.furnace.pos;
  L.state = 'arrive'; L.stT = 0; L.dormant = false; L.woke = true;
  L.pos.set(F.x + 90, F.y - 80, F.z + 60);
  L.fwd.set(-0.5, 0.6, -0.4).normalize();
  L.body.visible = true;
  for (const A of L.arms) A.mesh.visible = true;
  for (const cl of L.clubs) cl.visible = true;
  L.suckers.visible = true;
  L.armsInit = false; L.spd = L.speed * 1.2; L.fwdPrev.copy(L.fwd);
}
function startStrike(L, target) {
  L.state = 'strike'; L.stT = 0; L.dashed = false; L.tentFire = -1;
  L.strikeFrom.copy(L.pos);
  L.strikeTo.copy(target || L.aim);
}
function stunHim(L) {
  L.state = 'stunned'; L.stT = 0; L.stun = 10; L.stunT = 0;
  L.loll.v += 1.5;
  L.pendingMsg = L.pendingMsg || 'THE FIRE BLINDS HIM. HIS SHOAL SCATTERS. HE HANGS IN THE GLOW.';
}

// Arms trail behind the head (the head leads when he strikes; when cruising he swims
// mantle-first and they stream). Each arm is a verlet chain pulled toward that pose, so it
// carries momentum: it lags in a turn, trails on the surge, whips when he stops. The pose
// itself bunches on the jet and flares into a basket before a hit. Tentacles fire at the
// strike point ballistically (a quadratic arc, overshoot, snap back).
function buildArms(L, dt) {
  const b = L.body, head = _a.set(0, 0, 0.02).applyMatrix4(b.matrixWorld);
  const strike = L.state === 'strike', stun = L.stun > 0;
  const armDir = _c.copy(L.bz).negate();                          // out of the head, away from the tail
  // side and up from the body's own (banked) frame
  _w.setFromMatrixColumn(b.matrixWorld, 0).normalize();
  _p.setFromMatrixColumn(b.matrixWorld, 1).normalize();
  const k60 = Math.min(3, dt * 60), init = !L.armsInit;
  const conv = stun ? Math.max(0, 1 - L.stunT / 1.6) : 0, limp = stun ? sst(0.8, 2.5, L.stunT) : 0;
  const damp = Math.pow(stun ? 0.97 : 0.88, k60);
  for (let a = 0; a < NA; a++) {
    const A = L.arms[a];
    const sp = (A.tent ? 0.10 : 0.30) * (A.tent ? 1 : L.spread), ca = Math.cos(A.ang), sa = Math.sin(A.ang);
    const spread = _d.copy(_w).multiplyScalar(ca * sp).addScaledVector(_p, sa * sp);
    const shoot = A.tent ? A.shoot : 0;
    const len = A.len * (A.tent ? 0.35 + 0.65 * shoot : 1), seg = len / RINGS;
    const aim = A.tent && shoot > 0.02;
    if (aim) {
      // the arc: out along the body axis, then curving onto the strike point
      _fp.copy(head).addScaledVector(armDir, len * 0.45).addScaledVector(spread, len * 0.3);
    }
    const kS = stun ? lerp(0.30, 0.02, limp) : 1;
    const P = A.pts, Q = A.prev;
    for (let i = 0; i <= RINGS; i++) {
      const s = i / RINGS;
      // the pose this arm is being pulled toward
      const wv = Math.sin(L.t * 3.2 - s * 6 + a * 1.7) * len * 0.05 * s * (stun ? 0.3 : 1);
      _tv.set(0, 0, 0);
      if (aim) {
        const m = 1 - s;
        _g.copy(head).multiplyScalar(m * m).addScaledVector(_fp, 2 * m * s);
        _tv.copy(L.strikeTo).sub(head);
        const dl = _tv.length() || 1;
        _tv.multiplyScalar(Math.min(1.15, len / dl)).add(head);
        _g.addScaledVector(_tv, s * s);
      } else {
        _g.copy(head).addScaledVector(armDir, len * s)
          .addScaledVector(spread, len * s * (1 - 0.5 * s)).addScaledVector(_w, wv).addScaledVector(_p, wv * 0.6);
      }
      if (conv > 0) {
        const j = conv * len * 0.16 * s;
        _g.x += nzH(L.t * 14, a * 3 + i * 0.07) * j; _g.y += nzH(L.t * 12, a * 5 + 1 + i * 0.05) * j; _g.z += nzH(L.t * 13, a * 7 + 2) * j;
      }
      if (i === 0 || init) { P[i].copy(_g); Q[i].copy(_g); continue; }
      // verlet: carry the velocity, fall a little when he is limp, then pull toward the pose
      _tv.subVectors(P[i], Q[i]).multiplyScalar(damp);
      Q[i].copy(P[i]);
      P[i].add(_tv);
      if (limp > 0) P[i].y -= 14 * limp * dt * dt * 60 * s;
      const k = (aim ? 0.85 : lerp(0.35, 0.10, Math.pow(s, 0.7))) * kS;
      P[i].lerp(_g, 1 - Math.pow(1 - k, k60));
    }
    // inextensible: follow-the-leader from the root (two passes)
    // (the correction is also applied to the previous position, so the constraint moves
    // the chain without injecting velocity - the classic FTL jitter)
    for (let it = 0; it < 2; it++) for (let i = 1; i <= RINGS; i++) {
      _tv.subVectors(P[i], P[i - 1]);
      const l = _tv.length() || 1e-4;
      _g.copy(P[i]);
      P[i].copy(P[i - 1]).addScaledVector(_tv, seg / l);
      Q[i].add(_g.subVectors(P[i], _g).multiplyScalar(0.9));
    }
    if (stun) for (let i = 4; i <= RINGS; i += 1) { const gy = terrainH(P[i].x, P[i].z, L.idx) + 0.6; if (P[i].y < gy) P[i].y = gy; }
    // frames + tube: the dorsal U faces away from the crown's axis, so the oral face (-U,
    // pale, suckered) always looks in toward the other arms
    const pos = A.geo.attributes.position.array, nor = A.geo.attributes.normal.array, row = RADIAL + 1;
    for (let i = 0; i <= RINGS; i++) {
      _t.subVectors(A.pts[Math.min(RINGS, i + 1)], A.pts[Math.max(0, i - 1)]).normalize();
      const U = A.U[i];
      _r.subVectors(A.pts[i], head);
      _in.copy(armDir).multiplyScalar(_r.dot(armDir)).sub(_r);                  // toward the axis
      const il = _in.length();
      if (i === 0) U.copy(_p); else U.copy(A.U[i - 1]);
      if (il > len * 0.02) U.lerp(_in.multiplyScalar(-1 / il), Math.min(1, il / (len * 0.06)));
      U.addScaledVector(_t, -U.dot(_t)).normalize();
      _f.crossVectors(_t, U);
      const s = i / RINGS, r = A.r0 * Math.pow(1 - s, 0.7) + 0.08 + (A.tent && s > 0.85 ? A.r0 * 0.6 : 0);
      for (let j = 0; j <= RADIAL; j++) {
        const ca2 = CA[j], sa2 = SA[j], fl = ca2 < 0 ? 1 - 0.18 * ca2 * ca2 : 1;     // a flatter oral face
        const nx = U.x * ca2 * fl + _f.x * sa2, ny = U.y * ca2 * fl + _f.y * sa2, nz = U.z * ca2 * fl + _f.z * sa2;
        const k = (i * row + j) * 3;
        pos[k] = A.pts[i].x + nx * r; pos[k + 1] = A.pts[i].y + ny * r; pos[k + 2] = A.pts[i].z + nz * r;
        const nl = 1 / (Math.hypot(U.x * ca2 + _f.x * sa2 * fl, U.y * ca2 + _f.y * sa2 * fl, U.z * ca2 + _f.z * sa2 * fl) || 1);
        nor[k] = (U.x * ca2 + _f.x * sa2 * fl) * nl; nor[k + 1] = (U.y * ca2 + _f.y * sa2 * fl) * nl; nor[k + 2] = (U.z * ca2 + _f.z * sa2 * fl) * nl;
      }
    }
    A.geo.attributes.position.needsUpdate = true;
    A.geo.attributes.normal.needsUpdate = true;
    if (A.tent) {
      const club = L.clubs[a - 8], i = RINGS - 4;
      club.position.copy(A.pts[i]);
      _t.subVectors(A.pts[RINGS], A.pts[RINGS - 8]).normalize();
      _sd.crossVectors(A.U[i], _t).normalize();
      _in.crossVectors(_t, _sd);
      _m.makeBasis(_sd, _in, _t);
      club.quaternion.setFromRotationMatrix(_m);
    } else {
      // suckers: two staggered rows down the oral face
      for (let k = 0; k < SUCK * 2; k++) {
        const row2 = k & 1, t = ((k >> 1) + 0.5 * row2) / SUCK, s = 0.16 + 0.76 * Math.pow(t, 0.8);
        const x = s * RINGS, i0 = Math.min(RINGS - 1, x | 0), f = x - i0, U0 = A.U[i0], U1 = A.U[i0 + 1];
        const r = A.r0 * Math.pow(1 - s, 0.7) + 0.08;
        _in.copy(U0).lerp(U1, f).normalize().multiplyScalar(-1);
        _t.subVectors(A.pts[i0 + 1], A.pts[i0]).normalize();
        _sd.crossVectors(_t, _in);
        _r.copy(A.pts[i0]).lerp(A.pts[i0 + 1], f).addScaledVector(_in, r * 0.84).addScaledVector(_sd, (row2 ? 0.26 : -0.26) * r);
        _q.setFromUnitVectors(_y, _in);
        const sz = r * L.suckK;
        L.suckers.setMatrixAt(a * SUCK * 2 + k, _m.compose(_r, _q, _s.set(sz, sz, sz)));
      }
    }
  }
  L.suckers.instanceMatrix.needsUpdate = true;
  L.armsInit = true;
}

function place(L, dt) {
  const b = L.body;
  // the mantle's +Z (tail) points AWAY from the direction of travel when striking, and
  // along it when cruising (squid cruise tail-first): body +Z = -fwd in strike, +fwd cruising
  _t.copy(L.fwd);
  if (L.state === 'strike') _t.negate();
  // The body axis TURNS to its new heading (it used to snap end for end when a strike began):
  // a rate-limited swing through the side, never through a degenerate half-turn
  if (!(dt > 0) || !L.bz) L.bz = _t.clone();
  else {
    if (L.bz.dot(_t) < -0.8) { _g.crossVectors(UP, L.bz); if (_g.lengthSq() < 1e-4) _g.set(1, 0, 0); _t.addScaledVector(_g.normalize(), 0.8).normalize(); }
    L.bz.lerp(_t, 1 - Math.exp(-(L.state === 'strike' && L.stT < 0.9 ? 5 : 3) * dt)).normalize();
    _t.copy(L.bz);
  }
  // BANKING: the body's up leans toward the centre of the turn, by the (smoothed) lateral
  // acceleration of the heading, like anything with fins at speed. Stunned, he lolls.
  if (dt > 0) {
    _acc.subVectors(L.fwd, L.fwdPrev).multiplyScalar(Math.max(0.5, L.spd) / dt);
    _acc.addScaledVector(L.fwd, -_acc.dot(L.fwd));
    L.accS.lerp(_acc, 1 - Math.exp(-3 * dt));
  }
  L.fwdPrev.copy(L.fwd);
  // (tilt = atan(0.05 a), capped near 27 degrees)
  _g.copy(L.accS).multiplyScalar(0.05);
  if (_g.lengthSq() > 0.25) _g.setLength(0.5);
  _up.copy(UP).add(_g);
  if (L.stun > 0) {
    // convulsing, then limp: the body rolls over a little and the head sags
    const conv = Math.max(0, 1 - L.stunT / 1.6);
    _up.x += nzH(L.t * 11, 3) * 0.5 * conv + 0.35 * L.loll.x; _up.z += nzH(L.t * 9, 5) * 0.5 * conv;
  }
  _up.addScaledVector(_t, -_up.dot(_t));
  if (_up.lengthSq() < 1e-6) _up.set(0, 1, 0).addScaledVector(_t, -_t.y);
  _up.normalize();
  _bx.crossVectors(_up, _t).normalize();
  _by.crossVectors(_t, _bx);
  _m.makeBasis(_bx, _by, _t);
  b.quaternion.setFromRotationMatrix(_m);
  if (L.stun > 0) { _q.setFromAxisAngle(_bx, 0.25 * L.loll.x); b.quaternion.premultiply(_q); }
  b.position.copy(L.pos);
  b.updateMatrixWorld(true);
  for (let k = 0; k < L.spine.length; k++) L.spine[k].set(0, 0, 0.1 + k * 0.18).applyMatrix4(b.matrixWorld);
  L.head.set(0, 0, 0.05).applyMatrix4(b.matrixWorld);
  // the wards ride the skin, which the jet moves in and out (same curve as the shader)
  const cx = L.mU.uContract.value.x;
  for (const g of L.sigils) {
    const z = g.local0.z, mk = sst(0.10, 0.30, z) * (1 - sst(0.78, 0.98, z)), kk = 1 + cx * mk;
    g.local.set(g.local0.x * kk, g.local0.y * kk, z);
    g.grp.position.copy(g.local).applyMatrix4(b.matrixWorld);
    g.grp.quaternion.copy(b.quaternion).multiply(g.q);
  }
}

// One jet cycle of period T: the mantle contracts over the first fifth (thrust, a sine
// pulse), then refills slowly while he coasts. `mean` is the speed the cycle averages
// against JET_K drag. Returns nothing; writes L.spd, L.contract, L.inflate, L.jetPh.
function jet(L, dt, mean, T) {
  const tc = 0.22;
  L.jetPh += dt / T;
  if (L.jetPh >= 1) L.jetPh -= 1;
  const ph = L.jetPh;
  const A = mean * JET_K * T * Math.PI / (2 * tc * T);
  if (ph < tc) L.spd += A * Math.sin(Math.PI * ph / tc) * dt;
  L.spd *= Math.exp(-JET_K * dt);
  // contraction is fast, the refill slow and eased (the mantle swells back)
  L.contract = ph < tc ? Math.sin(0.5 * Math.PI * ph / tc) : 1 - sst(tc, 0.85, ph);
  L.inflate = sst(0.5, 0.95, ph);
}

export function updateHunter(L, dt, t, player) {
  const ev = EVH;
  ev.sigilLit = 0; ev.calmed = false; ev.lightDrain = 0; ev.slam = false; ev.remaining = 0; ev.msg = null; ev.woke = false; ev.warm = false;
  if (L.pendingMsg) { ev.msg = L.pendingMsg; L.pendingMsg = null; }
  if (L.woke) { L.woke = false; ev.woke = true; }
  if (!L.pPrev) L.pPrev = player.pos.clone();
  L.t += dt; L.stT += dt;
  const Fz = L.furnace, F = Fz.pos;

  // ---- the furnace ----
  Fz.heat += clamp((Fz.lit ? 1 : 0) - Fz.heat, -dt * 0.2, dt * 0.35);
  L.smokerMat.emissiveIntensity = 0.9 * Fz.heat * (0.85 + 0.15 * Math.sin(L.t * 3.1) * Math.sin(L.t * 1.3));
  // (encounter pass: the four throat sprites were 9-27 u across and stacked into a flat
  // orange paddle standing on the chimney; the shimmer strip's streaks printed through it as
  // a dotted pattern. The fire is a LIGHT now — the vents' throat light, borrowed while the
  // vent field sleeps — and the sprites are the tight glow at the bore.)
  for (let k = 0; k < L.fire.length; k++) {
    const gl = L.fire[k], d = gl.position.distanceTo(player.pos);
    gl.material.opacity = Fz.heat * FIRE_OP[k] * (0.85 + 0.15 * Math.sin(L.t * 5 + k));
    gl.scale.setScalar((3.6 - k * 0.6) * (1 + Math.min(2.2, d * 0.016)));
  }
  L.shimmer.material.opacity = 0.05 * Fz.heat;
  {
    const fl = Fz.heat > 0.01 ? lendVentLight() : null;
    if (fl) {
      fl.userData.lent = true;
      fl.color.setHex(FIRE); fl.distance = 60; fl.decay = 2.0;
      fl.position.set(Fz.top.x, Fz.top.y + 3, Fz.top.z);
      L.fireL = Fz.heat * (0.86 + 0.08 * Math.sin(L.t * 3.1) * Math.sin(L.t * 1.3) + 0.06 * Math.sin(L.t * 7.7));
      fl.intensity = SM.fireI * L.fireL;
      fl.userData.scatter = SM.fireS; fl.userData.lampBias = 1;
    }
  }
  L.shimmer.material.map.offset.y -= dt * 0.22;
  const dF = Math.hypot(player.pos.x - F.x, player.pos.z - F.z);
  // the warm pocket: near the lit furnace the air comes easy
  if (Fz.heat > 0.5 && dF < POCKET_R && player.pos.y < F.y + 40) {
    survival.oxygen = Math.min(1, survival.oxygen + dt * 0.05 * Fz.heat);
    ev.warm = true;
  }
  if (!ev.msg && !Fz.stumpFound) for (const s of Fz.stumps) if (s.distanceTo(player.pos) < 12) {
    Fz.stumpFound = true; ev.msg = 'A DEAD CHIMNEY. SCORCHED. SOMETHING BURNED HERE ONCE.'; break;
  }
  if (!ev.msg && !Fz.found && dF < 30 && player.pos.y < F.y + 40) { Fz.found = true; ev.msg = 'THE LAST FURNACE. COLD. IT WANTS FEEDING.'; }

  // ---- him ----
  if (L.state === 'absent') {
    if (Fz.lit && L.stT > 14) arrive(L);                             // he hunts heat
    ev.remaining = L.sigils.length;
    // his pool lights are idle until he comes: the reef borrows them (world/abyss.js)
    for (let i = 0; i < sigilPool.length; i++) sigilPool[i].userData.bioFree = true;
    return ev;
  }
  L.pulse = L.t;
  let pd = 1e9;
  for (const s of L.spine) { const d = s.distanceTo(player.pos); if (d < pd) pd = d; }
  L._pd = pd;
  const speedK = L.speed;
  let spreadT = 1, finAmp = 0.014, finRate = 4, fold = 0, tentOut = false;
  if (L.state === 'arrive') {
    _t.set(F.x + Math.cos(L.orbitA) * 70, F.y + 30, F.z + Math.sin(L.orbitA) * 70).sub(L.pos);
    const d = _t.length();
    L.fwd.lerp(_t.normalize(), Math.min(1, dt * 0.8)).normalize();
    jet(L, dt, speedK * 1.2, 1.3);
    L.pos.addScaledVector(L.fwd, L.spd * dt);
    spreadT = 1 + 0.25 * L.inflate - 0.6 * L.contract;
    if (d < 15 || L.stT > 12) { L.state = 'circle'; L.stT = 0; }
  } else if (L.state === 'circle') {
    // circle the diver out in the dark, closing, then strike
    L.orbitA += dt * 0.22;
    const R = 55 - Math.min(20, L.stT * 2);
    _t.set(player.pos.x + Math.cos(L.orbitA) * R, player.pos.y + 8 + 6 * Math.sin(L.t * 0.4), player.pos.z + Math.sin(L.orbitA) * R).sub(L.pos);
    L.fwd.lerp(_t.normalize(), Math.min(1, dt * 1.2)).normalize();
    jet(L, dt, speedK, 1.6);
    L.pos.addScaledVector(L.fwd, L.spd * dt);
    spreadT = 1 + 0.25 * L.inflate - 0.6 * L.contract;
    finAmp = 0.012 + 0.010 * (1 - L.contract); finRate = 3.5 + 3 * L.contract;
    if (L.stT > 7 && !L.calmed) { L.aim = player.pos.clone(); startStrike(L); }
  } else if (L.state === 'strike') {
    // drive through where the diver was, arms-first, tentacles out
    _t.copy(L.strikeTo).sub(L.pos);
    const d = _t.length();
    if (L.stT < 0.9) {
      // wind-up: turn to face him, back off, draw the whole mantle full, arms bunched to a
      // spear; the fins beat hard to hold him there
      L.fwd.lerp(_t.normalize(), Math.min(1, dt * 4)).normalize();
      L.spd += (-speedK * 0.3 - L.spd) * Math.min(1, 3 * dt);
      L.contract += (0 - L.contract) * Math.min(1, 8 * dt);
      L.inflate = sst(0.0, 0.7, L.stT) * 1.4;
      L.pos.addScaledVector(L.fwd, L.spd * dt);
      spreadT = 0.3; finAmp = 0.022; finRate = 9;
    } else {
      // THE JET: the whole breath at once
      // (4.2x decaying at 0.45/s covers the same ground in the first second as the old
      // constant 3.4x: the hit window is where it was, the dash now has a shape)
      if (!L.dashed) { L.dashed = true; L.spd = speedK * 4.2; }
      L.spd = Math.max(speedK * 1.2, L.spd * Math.exp(-0.45 * dt));
      L.contract = L.stT < 1.05 ? sst(0.9, 1.05, L.stT) : 1 - sst(1.6, 2.6, L.stT);
      L.inflate *= Math.exp(-6 * dt);
      L.pos.addScaledVector(L.fwd, L.spd * dt);
      // the tentacles fire when the strike point comes into their reach, and are hauled
      // back in 0.7 s later whatever they caught
      if (L.tentFire < 0 && L.head.distanceTo(L.strikeTo) < L.arms[8].len * 1.1) L.tentFire = L.stT;
      tentOut = L.tentFire >= 0 && L.stT - L.tentFire < 0.7;
      // arms spear in tight, then open into a basket as he arrives
      spreadT = d < 18 || L.hitThisStrike ? 2.1 : 0.45;
      finAmp = 0.004; finRate = 6; fold = 0.035;
      // the fire: a strike that runs through the flare blinds him
      if (Fz.heat > 0.6 && L.head.distanceTo(Fz.top) < FLARE_R) { stunHim(L); }
      // ink in his line breaks the strike
      if (L.state === 'strike' && player.inkAt && performance.now() - player.inkAt < 4000 && pd < 30) { L.state = 'circle'; L.stT = 0; L.orbitA += Math.PI; ev.msg = ev.msg || 'THE INK BREAKS HIS LINE.'; }
      // the hit
      if (L.state === 'strike' && pd < 7 && !L.hitThisStrike) {
        L.hitThisStrike = true;
        _r.copy(player.pos).sub(L.pos).normalize();
        player.vel.addScaledVector(_r, 40).addScaledVector(L.fwd, 20);
        ev.slam = true; ev.lightDrain += 0.2;
      }
      if (L.stT > 3.2 || (d < 4 && L.stT > 1.5)) { L.state = 'circle'; L.stT = 0; L.hitThisStrike = false; }
    }
  } else if (L.state === 'stunned') {
    // hanging in the glow, sinking slowly, the fire in his eyes: first he CONVULSES (the
    // mantle spasming, arms thrashing), then he goes limp and drifts
    L.stun -= dt;
    L.stunT += dt;
    const conv = Math.max(0, 1 - L.stunT / 1.6);
    L.spd *= Math.exp(-3 * dt);
    L.pos.addScaledVector(L.fwd, L.spd * dt);
    L.pos.y -= dt * 1.2;
    L.pos.y = Math.max(L.pos.y, terrainH(L.pos.x, L.pos.z, L.idx) + 6);
    L.contract = conv * (0.5 + 0.5 * Math.sin(L.t * 17)) * 0.8;
    L.inflate = -0.6 * sst(0.8, 3, L.stunT);                         // limp: the mantle slack
    sprH(L.loll, sst(0.8, 3.0, L.stunT), 1.4, 0.55, dt);
    spreadT = 1.3; finAmp = conv > 0 ? 0.02 * conv * nzH(L.t * 20, 1) : 0.002; finRate = conv > 0 ? 20 : 0.8;
    if (L.stun <= 0) { L.state = 'circle'; L.stT = 0; ev.msg = ev.msg || 'HE SHAKES OFF THE FIRE.'; }
  } else if (L.state === 'leave') {
    L.fwd.lerp(_dn, Math.min(1, dt)).normalize();
    jet(L, dt, speedK * 0.8, 2.0);
    L.pos.addScaledVector(L.fwd, L.spd * dt);
    spreadT = 1 + 0.25 * L.inflate - 0.6 * L.contract;
    if (L.stT > 16) { L.body.visible = false; for (const A of L.arms) A.mesh.visible = false; for (const c of L.clubs) c.visible = false; L.suckers.visible = false; }
  }
  if (L.state !== 'stunned') sprH(L.loll, 0, 2, 0.8, dt);
  // the tentacles: fired (a stiff, underdamped spring: they overshoot and quiver) and
  // hauled back in on a slower, damped one
  for (let k = 0; k < 2; k++) {
    const T = L.tip[k];
    if (tentOut) sprH(T, 1, 14, 0.32, dt); else sprH(T, 0, 5, 0.95, dt);
    L.arms[8 + k].shoot = Math.max(0, T.x);
  }
  L.spread += (spreadT - L.spread) * Math.min(1, 5 * dt);
  // never through the seabed
  const gy = terrainH(L.pos.x, L.pos.z, L.idx) + 5;
  if (L.pos.y < gy) L.pos.y = gy;

  // the mantle (shader): contract on the jet, swell on the refill, a ripple down it
  L.mU.uContract.value.set(0.07 * L.inflate - 0.13 * L.contract, 0.012 * L.contract, L.t * 7);
  // the fins: a wave running down them, beating harder as he steers the glide
  L.finPh += dt * finRate;
  L.finU.uFin.value.set(L.finPh, finAmp, -fold);

  place(L, dt);
  buildArms(L, dt);

  // photophores: they pulse when he hunts, gutter when stunned, go dark when calmed
  const hunt = L.state === 'strike' ? 1 : L.state === 'circle' ? 0.6 : 0.4;
  const ph = L.calmed ? 0.1 : L.stun > 0 ? 0.15 * (Math.sin(L.t * 17) > 0.6 ? 1 : 0) : hunt * (0.55 + 0.45 * Math.sin(L.t * (2 + 4 * hunt)));
  L.skin.emissiveIntensity = 1.8 * ph;
  L.mskin.emissiveIntensity = L.skin.emissiveIntensity;
  if (L.skinX) for (const m of L.skinX) m.emissiveIntensity = L.skin.emissiveIntensity;
  L.finMat.emissiveIntensity = 0.3 * ph;
  // the lens points: counter-illumination steady, the flank rows chasing when he hunts,
  // the eye rings brightest when he looks at you; they gutter with the stun
  {
    const U = L.photoU, lvl = L.calmed ? Math.max(0, 0.3 - L.calmT * 0.02) : L.stun > 0 ? ph * 2 : 0.45 + 0.55 * ph;
    U.uLvl.value.set(lvl * SM.flank, lvl * SM.belly * (L.stun > 0 ? 0.6 : 1), lvl * SM.eye, 2 + 7 * hunt);
    U.uT.value = L.t;
    renderer.getDrawingBufferSize(_px);
    U.uPix.value = _px.y / (2 * Math.tan(camera.fov * Math.PI / 360));
    U.uExt.value = scene.fog ? scene.fog.density * SM.ext : 0.01;
    L.photo = lvl;
  }
  // fins: a slow flap under the travelling wave, swept back against the body on the dash
  for (const f of L.fins) f.fin.rotation.z = f.sd * (0.10 * Math.sin(L.finPh * 0.5) * Math.min(1, finAmp * 60) - 3 * fold);
  // eyeshine
  _p.copy(player.pos).sub(L.head);
  const dist = _p.length() || 1;
  L.eyeMat.emissiveIntensity = (L.stun > 0 ? 1.2 : 0) + 1.6 * (1 - smooth(dist, 30, 110)) * Math.max(0, player.light || 0);

  // ---- wards: kept by the squid (zone 2), reachable when he is still enough ----
  const haloK = L.size * 0.6;
  if (!L.calmed) {
    let allLit = true;
    for (let i = 0; i < L.sigils.length; i++) {
      const g = L.sigils[i];
      if (g.lit) { wardLitPose(g, dt, haloK); continue; }
      allLit = false;
      g.rev = 1;
      wardIdle(g, dt, haloK);
      if (L.state === 'stunned') {
        // stunned, his wards wake hot and throw light across his hide: the moment you SEE
        // the size of him (borrowed pool lights — the light count never changes)
        g.light.intensity = 55 + 20 * Math.sin(L.t * 3 + i);
        // (encounter pass: the burning wards breathe a little warmth into the water over
        // his back — the one time his own light is warm)
        g.light.userData.scatter = 0.14;
        L.guardWards = false; wardTouch(L, i, g, player, ev); L.guardWards = true;
      }
      else if (!L.hinted && g.grp.position.distanceTo(player.pos) < L.reach) { L.hinted = true; ev.msg = ev.msg || 'HE WILL NOT HOLD STILL. NOT OUT HERE IN THE DARK.'; }
    }
    // the keepers ride his wards — except in the fire, which scatters the shoal
    if (L.state === 'stunned') setWardTargets(-1, null); else setWardTargets(L.idx, L.sigils);
    let rem = 0;
    for (const q of L.sigils) if (!q.lit) rem++;
    ev.remaining = rem;
    if (allLit) {
      L.calmed = true; L.calmT = 0; ev.calmed = true;
      L.state = 'leave'; L.stT = 0; L.stun = 0;
      setWardTargets(-1, null);
    }
  } else {
    L.calmT += dt;
    for (const g of L.sigils) {
      g.pulse += dt;
      g.light.intensity = Math.max(0, 120 - L.calmT * 7);
      g.light.userData.scatter = 0.04;
      g.light.position.copy(g.grp.position);
      g.halo.position.copy(g.grp.position);
      g.halo.scale.setScalar(haloK * 0.55);
      g.halo.material.opacity = 0.4;
    }
  }
  wardFlashes(L, dt, null);
  stageHunter(L, dt);
  L.pPrev.copy(player.pos);
  return ev;
}

// ---- THE STAGING (encounter pass) ---------------------------------------------------
// He carries his own light. No light is added: while a ward does not need its borrowed
// pool light (it is lit, flashing, he is stunned, or calmed), the light rides HIS BODY —
// four under the belly and one in the crown of his arms, cold, pulsing with the
// photophores. They light his underside, the arms trailing under him and the water round
// him; the middle one is the encounter's lamp-B source (userData.lampBias), so the murk
// itself brightens where he passes and his dark dorsal line reads against his own glow.
// Stunned, the wards take the lights (warm, on his back) and his body lights gutter: the
// moment you see the size of him is lit from the furnace and his own burning wards.
const _px = new THREE.Vector2(), _sp = V3();
const SM = { flank: 1.0, belly: 0.8, eye: 1.2, ext: 0.45, bodyI: 26, bodyR: 18, keyI: 80, keyR: 44, keyS: 1.6, fireI: 70, fireS: 0.18 };
if (typeof window !== 'undefined') window.__stageM = SM;
// body-frame stations (x is flipped to the flank that faces the lens: his rows run down
// both flanks, and the one you can see is the one whose light you should see on his hide)
//   0 the crown of his arms   1,3 the near flank, fore and aft, just below the rows
//   2 the key, ON HIS AXIS: its surface light never leaves his body, but its in-scatter
//     does — the haze's bright core is eclipsed by him and what shows is a halo round his
//     outline, strongest where he is thinnest (the rim he never had)   4 under the tail
const BODY_AT = [[0, -0.02, -0.07], [0.125, -0.06, 0.22], [0, 0, 0.40], [0.11, -0.05, 0.60], [0, -0.10, 0.80]];
function stageHunter(L, dt) {
  if (!L.stage) L.stage = sigilPool.map(() => ({ src: -1, cur: 0 }));
  const here = L.body.visible && L.state !== 'absent';
  const m = L.body.matrixWorld.elements;
  const near = ((camera.position.x - m[12]) * m[0] + (camera.position.y - m[13]) * m[1] + (camera.position.z - m[14]) * m[2]) >= 0 ? 1 : -1;
  for (let i = 0; i < L.stage.length; i++) {
    const pl = sigilPool[i], s = L.stage[i], g = i < L.sigils.length ? L.sigils[i] : null;
    if (g && (g.lit || g.flashT < 1.5 || L.state === 'stunned' || L.calmed)) {
      if (s.src !== -2) { s.src = -2; s.cur = 0; pl.color.setHex(WARD_COL); pl.distance = 50; pl.decay = 2.0; pl.userData.lampBias = undefined; }
      pl.userData.bioFree = false;
      // lifted off the hide along the ward's face: a light ON the skin only grazes it (the
      // burning wards used to light nothing round them); 2.5 u out it pools on his back
      pl.position.copy(g.grp.position).addScaledVector(_sp.set(0, 0, 1).applyQuaternion(g.grp.quaternion), 2.5);
      continue;
    }
    const want = here ? i : -1, key = i === 2;
    const I = here ? (key ? SM.keyI : SM.bodyI) * (0.35 + 0.65 * L.photo) : 0;
    if (s.src !== want) { s.cur = Math.max(0, s.cur - dt * 80); if (s.cur <= 0) s.src = want; }
    else s.cur += clamp(I - s.cur, -dt * 80, dt * 60);
    pl.intensity = s.cur;
    // IDLE (he is absent and this light has faded out): the reef may borrow it
    // (world/abyss.js rides it on a bioluminescent colony); the frame he needs it the
    // flag drops and every property below is rewritten, so nothing of the reef's leaks.
    pl.userData.bioFree = s.src < 0 && s.cur <= 0;
    if (s.src < 0) continue;
    const b = BODY_AT[s.src];
    pl.position.copy(_sp.set(b[0] * near, b[1], b[2]).applyMatrix4(L.body.matrixWorld));
    pl.color.setHex(PHOTO_LIGHT);
    pl.decay = 2.0;
    pl.distance = key ? SM.keyR : SM.bodyR;
    pl.userData.scatter = key ? SM.keyS : 0.06;
    pl.userData.lampBias = key ? 4 : undefined;
  }
}
