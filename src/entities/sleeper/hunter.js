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
import { scene, envTexDeep as envTex } from '../../core.js';
import { V3, clamp, lerp } from '../../lib/math.js';
import { seededRand, makeGlow, glowTex } from '../../lib/textures.js';
import * as K from './hoarderGeo.js';
import { registerPaint } from '../../lib/paint.js';
import { terrainH } from '../../world/terrain.js';
import { setWardTargets, wardGuardCount } from '../../world/predators.js';
import { riftPos, WORLD_R } from '../../config.js';
import { survival } from '../../systems/survival.js';
import {
  setLive, SIGIL_POOL_N, ensureSigilPool, makeWard, wardIdle, wardLitPose, wardTouch, wardFlashes, makeEmbers
} from './common.js';

const TAU = Math.PI * 2;
const smooth = THREE.MathUtils.smoothstep;
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const UP = V3(0, 1, 0);
const ML_OF_SIZE = 3.6, NA = 10, RINGS = 56, RADIAL = 20, SUCK = 14;
const FEED_COST = 2, FEED_R = 5, POCKET_R = 28, FLARE_R = 22;
const _a = V3(), _b = V3(), _c = V3(), _d = V3(), _t = V3(), _p = V3(), _f = V3(), _r = V3(), _w = V3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = V3(), _z = V3(0, 0, 1), _y = V3(0, 1, 0), _in = V3(), _sd = V3(), _dn = V3(0.3, -1, 0.2).normalize();
// the photophore glow: 24 stations on the flanks (two rows each side) and the belly
const GLOW_N = 24;
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
function membrane(m) {
  m.customProgramCacheKey = () => 'abyssa-mhor-fin';
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', /* glsl */`{
        float fnThin = smoothstep(0.35, 1.0, vMapUv.x);
        vec3 fnLit = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
        vec3 fnIrr = fnLit / max(diffuseColor.rgb, vec3(0.08));
        float fnV = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        outgoingLight += fnThin * vec3(0.95, 0.30, 0.16) * fnIrr * (0.20 + 0.45 * fnV) * clamp(diffuseColor.r * 3.0, 0.0, 1.0);
        outgoingLight += fnThin * fnThin * totalEmissiveRadiance * 1.5;
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
// The great eye: a black pupil filling most of it, a thin GOLD ring, a silvered iris.
let _meye = null;
function eyeMaps(S = 256) {
  if (_meye) return _meye;
  const { A: TA, B: TB } = K.NT(), alb = new Uint8Array(S * S * 4), emi = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const px = (x + 0.5) / S * 2 - 1, py = (y + 0.5) / S * 2 - 1, r = Math.hypot(px * 0.92, py), th = Math.atan2(py, px), j = (y * S + x) * 4;
    const f = 0.75 + 0.5 * K.nt(TB, th / TAU * 12, r * 4);
    let c, e;
    if (r < 0.52) { c = [0.006, 0.006, 0.008]; e = 0.30 * (1 - sst(0.2, 0.52, r)) + 0.05; }
    else if (r < 0.60) { const k = Math.sin((r - 0.52) / 0.08 * Math.PI); c = [0.85 * k * f, 0.62 * k * f, 0.20 * k * f]; e = 0.45 * k; }
    else if (r < 0.86) { const m = 0.5 + 0.5 * K.nt(TA, th / TAU * 20, r * 6); c = [0.40 * m, 0.40 * m, 0.42 * m].map(q => q * (1 - 0.6 * sst(0.7, 0.86, r))); e = 0.08; }
    else { c = [0.08, 0.03, 0.03]; e = 0; }
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
    sigils: [], arms: [], stun: 0, pulse: 0, orbitA: 0, strikeFrom: V3(), strikeTo: V3(), _pd: 1e9
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
    emissive: 0xff8a3a, emissiveMap: hide.emissiveMap, emissiveIntensity: 0, side: THREE.FrontSide
  }), 'abyssa-mhor-skin', 0));
  L.skin = skin;
  const mg = mantleGeo();
  const mantle = new THREE.Mesh(mg, skin);
  mantle.castShadow = true;
  body.add(mantle);
  const finMat = registerPaint(membrane(new THREE.MeshStandardMaterial({ color: 0xffffff, map: fm.map, normalMap: fm.normalMap, roughness: 0.42, metalness: 0,
    side: THREE.DoubleSide, forceSinglePass: true, transparent: false, envMap: envTex, envMapIntensity: 0.35, emissive: 0xff8a3a, emissiveIntensity: 0 })));
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
      pts: Array.from({ length: RINGS + 1 }, () => V3()), U: Array.from({ length: RINGS + 1 }, () => V3())
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
  // the photophore GLOW: pooled additive points (fog off, their own distance curve) in the
  // body frame, so they cost one draw and no per-frame writes but two floats
  const gp = new Float32Array(GLOW_N * 3);
  for (let k = 0; k < GLOW_N; k++) {
    let a, s;
    if (k < 20) { const side = k < 10 ? 0 : Math.PI, row = (k % 10) < 5 ? 0.22 : -0.22; a = side + (side ? -row : row); s = 0.18 + 0.13 * (k % 5) + (row > 0 ? 0 : 0.06); }
    else { a = -Math.PI / 2 + ((k - 20) - 1.5) * 0.35; s = 0.30 + 0.09 * (k - 20); }
    const r = prof(s) * 1.06;
    gp[k * 3] = Math.cos(a) * r * 1.04; gp[k * 3 + 1] = Math.sin(a) * r; gp[k * 3 + 2] = s;
  }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.BufferAttribute(gp, 3));
  L.glowMat = new THREE.PointsMaterial({ map: glowTex, color: 0xff8a3a, size: 3, sizeAttenuation: true, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  L.glow = new THREE.Points(gg, L.glowMat);
  L.glow.frustumCulled = false;
  body.add(L.glow);

  // ---- wards: five on the mantle, kept by the squid (the zone-2 rule) ----
  const WS = [[0.10, 0.25], [-0.10, 0.40], [0.10, 0.55], [-0.10, 0.68], [0, 0.32]];
  for (let i = 1; i <= c.nSigils; i++) {
    const w = makeWard(L, i, 3.6);
    const [side, s] = WS[(i - 1) % WS.length];
    w.local = V3(side * 1.0, 0.085, s);                               // on the dorsal barrel
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
  scene.add(grp);
  setLive(L);
  setWardTargets(-1, null);
  return L;
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
}
function startStrike(L, target) {
  L.state = 'strike'; L.stT = 0;
  L.strikeFrom.copy(L.pos);
  L.strikeTo.copy(target || L.aim);
}
function stunHim(L) {
  L.state = 'stunned'; L.stT = 0; L.stun = 10;
  L.pendingMsg = L.pendingMsg || 'THE FIRE BLINDS HIM. HIS SHOAL SCATTERS. HE HANGS IN THE GLOW.';
}

// Arms trail behind the head (the head leads when he strikes; when cruising he swims
// mantle-first and they stream). Tentacles shoot out on a strike.
function buildArms(L, dt) {
  const b = L.body, head = _a.set(0, 0, 0.02).applyMatrix4(b.matrixWorld);
  // the arms stream from the head AWAY from the tail: trailing when he cruises tail-first,
  // leading when he strikes head-first
  const armDir = _c.copy(L.fwd).multiplyScalar(L.state === 'strike' ? 1 : -1);
  _w.crossVectors(L.fwd, UP).normalize();
  _p.crossVectors(_w, L.fwd).normalize();                           // body up
  for (let a = 0; a < NA; a++) {
    const A = L.arms[a];
    const sp = A.tent ? 0.10 : 0.30, ca = Math.cos(A.ang), sa = Math.sin(A.ang);
    const spread = _d.copy(_w).multiplyScalar(ca * sp).addScaledVector(_p, sa * sp);
    const shoot = A.tent ? A.shoot : 0;
    const len = A.len * (A.tent ? 0.35 + 0.65 * shoot : 1);
    for (let i = 0; i <= RINGS; i++) {
      const s = i / RINGS;
      const wv = Math.sin(L.t * 3.2 - s * 6 + a * 1.7) * len * 0.05 * s * (L.stun > 0 ? 0.3 : 1);
      A.pts[i].copy(head).addScaledVector(armDir, len * s)
        .addScaledVector(spread, len * s * (1 - 0.5 * s)).addScaledVector(_w, wv).addScaledVector(_p, wv * 0.6);
      if (L.stun > 0) A.pts[i].y -= len * 0.25 * s * s;              // limp: the arms hang
    }
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
        const sz = r * 0.19;
        L.suckers.setMatrixAt(a * SUCK * 2 + k, _m.compose(_r, _q, _s.set(sz, sz, sz)));
      }
    }
  }
  L.suckers.instanceMatrix.needsUpdate = true;
}

function place(L) {
  const b = L.body;
  // the mantle's +Z (tail) points AWAY from the direction of travel when striking, and
  // along it when cruising (squid cruise tail-first): body +Z = -fwd in strike, +fwd cruising
  _t.copy(L.fwd);
  if (L.state === 'strike') _t.negate();
  _q.setFromUnitVectors(_z, _t);
  b.quaternion.copy(_q);
  // keep him upright-ish: roll the body so its +Y stays toward world up
  b.position.copy(L.pos);
  b.updateMatrixWorld(true);
  for (let k = 0; k < L.spine.length; k++) L.spine[k].set(0, 0, 0.1 + k * 0.18).applyMatrix4(b.matrixWorld);
  L.head.set(0, 0, 0.05).applyMatrix4(b.matrixWorld);
  for (const g of L.sigils) {
    g.grp.position.copy(g.local).applyMatrix4(b.matrixWorld);
    g.grp.quaternion.copy(b.quaternion).multiply(g.q);
  }
}

export function updateHunter(L, dt, t, player) {
  const ev = { sigilLit: 0, calmed: false, lightDrain: 0, slam: false, remaining: 0, msg: null };
  if (L.pendingMsg) { ev.msg = L.pendingMsg; L.pendingMsg = null; }
  if (L.woke) { L.woke = false; ev.woke = true; }
  if (!L.pPrev) L.pPrev = player.pos.clone();
  L.t += dt; L.stT += dt;
  const Fz = L.furnace, F = Fz.pos;

  // ---- the furnace ----
  Fz.heat += clamp((Fz.lit ? 1 : 0) - Fz.heat, -dt * 0.2, dt * 0.35);
  L.smokerMat.emissiveIntensity = 0.9 * Fz.heat * (0.85 + 0.15 * Math.sin(L.t * 3.1) * Math.sin(L.t * 1.3));
  for (let k = 0; k < L.fire.length; k++) {
    const gl = L.fire[k], d = gl.position.distanceTo(player.pos);
    gl.material.opacity = Fz.heat * (0.8 - k * 0.15) * (0.85 + 0.15 * Math.sin(L.t * 5 + k));
    gl.scale.setScalar((9 - k * 1.5) * (1 + Math.min(3, d * 0.02)));
  }
  L.shimmer.material.opacity = 0.30 * Fz.heat;
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
    return ev;
  }
  L.pulse = L.t;
  let pd = 1e9;
  for (const s of L.spine) { const d = s.distanceTo(player.pos); if (d < pd) pd = d; }
  L._pd = pd;
  const speedK = L.speed;
  if (L.state === 'arrive') {
    _t.set(F.x + Math.cos(L.orbitA) * 70, F.y + 30, F.z + Math.sin(L.orbitA) * 70).sub(L.pos);
    const d = _t.length();
    L.fwd.lerp(_t.normalize(), Math.min(1, dt * 0.8)).normalize();
    L.pos.addScaledVector(L.fwd, speedK * 1.2 * dt);
    if (d < 15 || L.stT > 12) { L.state = 'circle'; L.stT = 0; }
  } else if (L.state === 'circle') {
    // circle the diver out in the dark, closing, then strike
    L.orbitA += dt * 0.22;
    const R = 55 - Math.min(20, L.stT * 2);
    _t.set(player.pos.x + Math.cos(L.orbitA) * R, player.pos.y + 8 + 6 * Math.sin(L.t * 0.4), player.pos.z + Math.sin(L.orbitA) * R).sub(L.pos);
    L.fwd.lerp(_t.normalize(), Math.min(1, dt * 1.2)).normalize();
    L.pos.addScaledVector(L.fwd, speedK * dt);
    if (L.stT > 7 && !L.calmed) { L.aim = player.pos.clone(); startStrike(L); }
  } else if (L.state === 'strike') {
    // drive through where the diver was, arms-first, tentacles out
    _t.copy(L.strikeTo).sub(L.pos);
    const d = _t.length();
    if (L.stT < 0.9) {
      // wind-up: turn to face him, drift back
      L.fwd.lerp(_t.normalize(), Math.min(1, dt * 4)).normalize();
      L.pos.addScaledVector(L.fwd, -speedK * 0.3 * dt);
    } else {
      L.pos.addScaledVector(L.fwd, speedK * 3.4 * dt);
      for (let k = 8; k < 10; k++) L.arms[k].shoot = Math.min(1, L.arms[k].shoot + dt * 3);
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
    // hanging in the glow, sinking slowly, the fire in his eyes
    L.stun -= dt;
    L.pos.y -= dt * 1.2;
    L.pos.y = Math.max(L.pos.y, terrainH(L.pos.x, L.pos.z, L.idx) + 6);
    if (L.stun <= 0) { L.state = 'circle'; L.stT = 0; ev.msg = ev.msg || 'HE SHAKES OFF THE FIRE.'; }
  } else if (L.state === 'leave') {
    L.fwd.lerp(_dn, Math.min(1, dt)).normalize();
    L.pos.addScaledVector(L.fwd, speedK * 0.8 * dt);
    if (L.stT > 16) { L.body.visible = false; for (const A of L.arms) A.mesh.visible = false; for (const c of L.clubs) c.visible = false; L.suckers.visible = false; }
  }
  for (let k = 8; k < 10; k++) if (L.state !== 'strike') L.arms[k].shoot = Math.max(0, L.arms[k].shoot - dt * 1.5);
  // never through the seabed
  const gy = terrainH(L.pos.x, L.pos.z, L.idx) + 5;
  if (L.pos.y < gy) L.pos.y = gy;

  place(L);
  buildArms(L, dt);

  // photophores: they pulse when he hunts, gutter when stunned, go dark when calmed
  const hunt = L.state === 'strike' ? 1 : L.state === 'circle' ? 0.6 : 0.4;
  const ph = L.calmed ? 0.1 : L.stun > 0 ? 0.15 * (Math.sin(L.t * 17) > 0.6 ? 1 : 0) : hunt * (0.55 + 0.45 * Math.sin(L.t * (2 + 4 * hunt)));
  L.skin.emissiveIntensity = 1.8 * ph;
  L.finMat.emissiveIntensity = 0.3 * ph;
  // the GLOW reads across the murk: fog-off points on their own distance curve, swelling
  // with range (murk grows halos), gone past ~200 u
  {
    const dG = L.head.distanceTo(player.pos), far = 1 - Math.min(1, Math.max(0, (dG - 60) / 140));
    L.glowMat.opacity = Math.min(1, 1.5 * ph) * (0.35 + 0.65 * far) * (dG > 200 ? 0 : 1);
    L.glowMat.size = 2.4 * (1 + Math.min(3, dG * 0.025));
  }
  // fins ripple
  for (const f of L.fins) f.fin.rotation.z = f.sd * 0.25 * Math.sin(L.t * (L.state === 'strike' ? 9 : 3));
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
        L.guardWards = false; wardTouch(L, i, g, player, ev); L.guardWards = true;
      }
      else if (!L.hinted && g.grp.position.distanceTo(player.pos) < L.reach) { L.hinted = true; ev.msg = ev.msg || 'HE WILL NOT HOLD STILL. NOT OUT HERE IN THE DARK.'; }
    }
    // the keepers ride his wards — except in the fire, which scatters the shoal
    if (L.state === 'stunned') setWardTargets(-1, null); else setWardTargets(L.idx, L.sigils);
    ev.remaining = L.sigils.filter(q => !q.lit).length;
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
      g.light.position.copy(g.grp.position);
      g.halo.position.copy(g.grp.position);
    }
  }
  wardFlashes(L, dt, null);
  L.pPrev.copy(player.pos);
  return ev;
}
