// THE BOILER ROOM — zone 1's hydrothermal vent field. OWNED BY: vents agent.
//
// A cluster of black-smoker chimneys grown on the zone-1 seabed, passed twice on every
// dive. Geology, not a light show: gnarled lathe-turned stone, stained by its own
// mineral runoff, venting slow dark plumes. The only warmth is a dim ember tint deep in
// a handful of active throats and a faint shimmer over the hottest three — never a
// beacon.
//
// Everything solid (chimneys, forked branches, secondary spires, talus aprons, fallen
// rubble, fumarole beehives, crust plates) bakes into
// ONE merged MeshStandardMaterial + vertexColors mesh, the diver.js/wrecks.js Part idiom
// copied locally (not imported — raft/kit.js and wrecks.js own their own copies too).
// Plumes and shimmer are GPU-side Points streams keyed off a shared uTime/uVis uniform,
// exactly water.js's buildBubbles pattern: all motion in the vertex shader, the CPU only
// ever writes two floats a frame for them.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, camera } from '../core.js';
import { riftPos } from '../config.js';
import { registerPaint } from '../lib/paint.js';
import { clamp, vnoise } from '../lib/math.js';
import { makeGlow, sulphideSet } from '../lib/textures.js';
import { terrainH, terrainNormal } from './terrain.js';
import { siteParams } from './site.js';

const TAU = Math.PI * 2;
const ZI = 1;   // zone 1 only, per brief

// ---------------------------------------------------------------------------
// Deterministic PRNG — mulberry32, drawn fresh per build from siteParams('vents').rng
// (site.js's own stream() factory, the same mulberry32 body this file used to keep
// inline). Site 0's seed constant is 0xB01Ec0DE — byte-identical to the fixed seed
// this module shipped with — and every draw below happens in the exact order it did
// before this file took a stream instead of owning its own counter, so site 0 grows
// the SHIPPED field. `rnd` is a `let` reassigned per build/reseed, never the counter
// itself, so a reseed can never resume mid-stream from a stale cursor.
// ---------------------------------------------------------------------------
let rnd = null;
const rng = (a, b) => a + rnd() * (b - a);

// ---------------------------------------------------------------------------
// Placement rules (brief, hard constraints).
// ---------------------------------------------------------------------------
const FIELD_R = 240;          // stay inside radius 240 of the world origin
const RIFT1_CLEAR = 45;       // clear of riftPos(1) — the zone's own exit funnel
const RIFT0_CLEAR = 30;       // clear of riftPos(0) — divers descend that line
const SLOPE_MAX_DEG = 35;
const SLOPE_MIN_NY = Math.cos(SLOPE_MAX_DEG * Math.PI / 180);   // 0.8192
const RC1 = riftPos(1), RC0 = riftPos(0);

const N_CLUSTERS = 4;
const PER_CLUSTER = [4, 4, 4, 5];   // 17 chimneys total
const CLUSTER_R = 16;               // chimney scatter radius around each cluster centre

// ------------------------------------------------------------------- Part/bake --
// Local copy of the merged-geometry idiom (diver.js / wrecks.js / raft/kit.js): bucket
// by material, merge each bucket once. Everything here shares ONE material, so this
// collapses the whole field to a single draw call.
function Part(node) {
  const b = new Map();
  return {
    add(geo, mat) { let a = b.get(mat); if (!a) b.set(mat, a = []); a.push(geo); return geo; },
    bake() {
      for (const [mat, list] of b) {
        for (const g of list) {
          if (!g.attributes.color)
            g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
          if (!g.attributes.uv)
            g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
          if (g.index === null) g.setIndex([...Array(g.attributes.position.count).keys()]);
        }
        const m = new THREE.Mesh(list.length > 1 ? mergeGeometries(list, false) : list[0], mat);
        m.castShadow = false; m.receiveShadow = true;
        node.add(m);
      }
      b.clear();
      return node;
    }
  };
}

// ------------------------------------------------------------------- geometry ---
// POLISH-VENTS: the chimneys are GROWN as one continuous tube per stem, not stacked
// lathe lumps. THE STREAM CONTRACT: buildChimney() still makes every site-stream draw the
// shipped version made, in the same order (segment count, base radius, and per segment
// height / jitter / lean / yaw; the fork's the same), and its spine arithmetic is
// unchanged — so the throat (ember, plume, shimmer, ventlife, marine-snow columns) and
// the colliders land exactly where they always did, and every later draw (fumaroles,
// crust, plumes, shimmer) is untouched. All NEW detail — flanges, fluting, spires,
// rubble, the talus apron — draws from a local mulberry32 seeded per chimney.
//
// Every vertex carries colour (the sulphide zoning, baked) and aVent (x = heat: 0 cold
// foot .. 0.9 at the throat lip, 1.0 inside the bore; y = bacterial-mat cover; z = the
// crystalline-glitter weight). The shared material (buildChimneyMat) reads all three.
function localRng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (x, z, k) => (Math.imul(Math.round(x * 97) | 0, 73856093) ^ Math.imul(Math.round(z * 97) | 0, 19349663) ^ Math.imul(k | 0, 83492791)) | 0;

// Zone palette (sRGB hex -> linear via THREE.Color): fresh sulphide is near-black,
// weathering runs grey -> iron-oxide orange -> ochre, anhydrite and bacterial mats are
// chalky white, the throat's chalcopyrite lining is brassy.
// (albedos kept at real sulphide values ~0.02-0.1 linear: darker than this and the
// lantern cannot find the crust at all in a lightless zone)
const Z_BLACK = new THREE.Color(0x2a2622), Z_GREY = new THREE.Color(0x57524b), Z_ASH = new THREE.Color(0x77736b);
const Z_RUST = new THREE.Color(0x7c3817), Z_ORANGE = new THREE.Color(0xa24c1a), Z_OCHRE = new THREE.Color(0x9c7030);
const Z_MAT = new THREE.Color(0xd3cebf), Z_BRASS = new THREE.Color(0x8c7042), Z_EMBER = new THREE.Color(0x3a1206);
const LEE = new THREE.Vector2(-Math.cos(0.9), -Math.sin(0.9));   // down-current of flora's mean current
const _zc = new THREE.Color();

// Colour + aVent for one exterior vertex. s = height fraction up the stem, y = world y,
// n = outward normal (after the build), heat = 0..0.9, dead = oxidised through.
function zone(out, s, y, nx, ny, nz, heat, dead, ph) {
  const ang = Math.atan2(nz, nx);
  const splotch = vnoise(y * 0.9 + ph * 3.1, ang * 1.3 + ph);
  // body: sooty grey-black sulphide, value-mottled
  _zc.copy(Z_BLACK).lerp(Z_GREY, 0.15 + 0.4 * splotch);
  // growth rings: a faint value banding up the stem (not a colour stripe)
  const ring = Math.sin(y * 2.3 + vnoise(ang * 2 + ph, y * 0.5) * 2.5);
  _zc.multiplyScalar(0.9 + 0.1 * ring);
  // iron-oxide weathering: DRIP STREAKS running down the flanks plus rusty patches,
  // both only where the wall has cooled; a dead chimney rusts right through
  const cold = clamp(1 - heat * 1.3, 0, 1);
  const drip = clamp((vnoise(ang * 4.5 + ph, y * 0.22 - ph) - 0.62) * 3.2, 0, 1);
  const patch = clamp((splotch - 0.66) * 3.0, 0, 1);
  let ox = Math.max(drip * 0.7, patch * 0.6) * cold;
  if (dead) ox = Math.max(ox, 0.3 + 0.4 * splotch);
  _zc.lerp(splotch > 0.5 ? Z_OCHRE : Z_RUST, ox * 0.85);
  _zc.lerp(Z_ORANGE, drip * patch * cold * 0.5);
  // chalky anhydrite flecks where the wall is still warm
  const anh = clamp((vnoise(y * 2.6 - ph, ang * 3.3) - 0.72) * 4, 0, 1) * clamp(heat * 2 - 0.3, 0, 1) * (dead ? 0 : 1);
  _zc.lerp(Z_ASH, anh * 0.6);
  // heat-darkening toward the throat: fresh black sulphide
  _zc.lerp(Z_BLACK, clamp((heat - 0.35) / 0.5, 0, 1) * (dead ? 0.3 : 0.9));
  // bacterial mats: lee faces, flange undersides, mid-low stem, broken into patches
  const lee = clamp((nx * LEE.x + nz * LEE.y) * 1.4 + 0.1, 0, 1);
  const under = clamp(-ny * 1.6, 0, 1);
  const patchN = vnoise(y * 3.4 + ph * 5.0, ang * 4.4 - ph) * 0.65 + vnoise(y * 0.8 - ph, ang * 1.1 + ph) * 0.35;
  let mat = Math.max(lee * 0.8, under * 0.9) * clamp((patchN - 0.5) * 3.5, 0, 1) * clamp(1.1 - heat * 1.25, 0, 1);
  if (dead) mat *= 0.45;
  out.mat = clamp(mat, 0, 1);
  out.glit = dead ? 0 : clamp((heat - 0.72) / 0.18, 0, 1);
  out.r = _zc.r; out.g = _zc.g; out.b = _zc.b;
}

// A grown tube along a spine: rings at the given height fractions, R(s, a) supplies the
// wall radius (flanges, lobes, fluting all live in it). `top` closes the stem: 'bore'
// (a rim that turns in and drops into a dark bore, active or cold), 'broken' (a jagged
// snapped end over a shallow bore), or 'cap' (a closed spire tip).
const _sp = new THREE.Vector3(), _st = new THREE.Vector3(), _sb1 = new THREE.Vector3(), _sb2 = new THREE.Vector3();
const _ZA = new THREE.Vector3(0, 0, 1);
function stemGeo(curve, ss, sides, R, o) {
  const pos = [], idx = [], meta = [];   // meta: per vertex [s, heatOverride(-1 = exterior)]
  const ringAt = (s, rs, jag, lift) => {
    curve.getPointAt(Math.min(1, s), _sp); curve.getTangentAt(Math.min(1, s), _st);
    _sb1.crossVectors(_st, _ZA).normalize(); _sb2.crossVectors(_st, _sb1).normalize();
    const base = pos.length / 3;
    for (let k = 0; k < sides; k++) {
      const a = k / sides * TAU;
      const r = rs(s, a);
      const dy = (jag ? jag(a) : 0) + (lift || 0);
      pos.push(_sp.x + (_sb1.x * Math.cos(a) + _sb2.x * Math.sin(a)) * r + _st.x * dy,
        _sp.y + (_sb1.y * Math.cos(a) + _sb2.y * Math.sin(a)) * r + _st.y * dy,
        _sp.z + (_sb1.z * Math.cos(a) + _sb2.z * Math.sin(a)) * r + _st.z * dy);
    }
    return base;
  };
  const link = (a0, a1, flip) => {
    for (let k = 0; k < sides; k++) {
      const a = a0 + k, b = a0 + (k + 1) % sides, c = a1 + k, d = a1 + (k + 1) % sides;
      if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  };
  let prev = -1;
  for (let j = 0; j < ss.length; j++) {
    const jag = (j === ss.length - 1 && o.top === 'broken') ? o.jag : null;
    const b = ringAt(ss[j], R, jag, 0);
    for (let k = 0; k < sides; k++) meta.push(ss[j], -1);
    if (prev >= 0) link(prev, b, false);
    prev = b;
  }
  const sTop = ss[ss.length - 1];
  if (o.top === 'cap') {
    curve.getPointAt(1, _sp); curve.getTangentAt(1, _st);
    const r1 = R(1, 0);
    const ap = pos.length / 3;
    pos.push(_sp.x + _st.x * r1 * 0.8, _sp.y + _st.y * r1 * 0.8, _sp.z + _st.z * r1 * 0.8);
    meta.push(1, -1);
    for (let k = 0; k < sides; k++) idx.push(prev + k, prev + (k + 1) % sides, ap);
  } else {
    // rim turns inward over the lip, then the bore drops away inside
    const rTop = (a) => R(sTop, a);
    const lip = ringAt(sTop, (s, a) => rTop(a) * 0.82, o.top === 'broken' ? o.jag : null, 0.06);
    for (let k = 0; k < sides; k++) meta.push(sTop, 0.97);
    link(prev, lip, false);
    const inner = ringAt(sTop, (s, a) => rTop(a) * 0.56, o.top === 'broken' ? o.jag : null, -0.05);
    for (let k = 0; k < sides; k++) meta.push(sTop, 1.0);
    link(lip, inner, false);
    const deep = ringAt(sTop, (s, a) => rTop(a) * 0.5, null, -(o.boreDepth || 1.2));
    for (let k = 0; k < sides; k++) meta.push(sTop, 1.0);
    link(inner, deep, false);
    curve.getPointAt(1, _sp); curve.getTangentAt(1, _st);
    const fl = pos.length / 3, dd = -(o.boreDepth || 1.2);
    pos.push(_sp.x + _st.x * dd, _sp.y + _st.y * dd, _sp.z + _st.z * dd);
    meta.push(sTop, 1.0);
    for (let k = 0; k < sides; k++) idx.push(deep + k, deep + (k + 1) % sides, fl);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // winding self-check: the first ring's normal must face out from the spine
  curve.getPointAt(ss[0], _sp);
  const nA = g.attributes.normal, pA = g.attributes.position;
  if ((pA.getX(0) - _sp.x) * nA.getX(0) + (pA.getZ(0) - _sp.z) * nA.getZ(0) < 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.computeVertexNormals();
  }
  g.userData.meta = meta;
  return g;
}

// Colour + aVent for a built stem. heatOf(s) maps height fraction to exterior heat.
const _zo = { r: 0, g: 0, b: 0, mat: 0, glit: 0 };
function paintStem(g, heatOf, dead, active, ph) {
  const p = g.attributes.position, n = g.attributes.normal, meta = g.userData.meta, c = p.count;
  const col = new Float32Array(c * 3), av = new Float32Array(c * 3);
  for (let i = 0; i < c; i++) {
    const s = meta[i * 2], ov = meta[i * 2 + 1];
    if (ov >= 0.96) {
      // lip + bore: black sulphide, brassy glitter on the lip, the bore floor warm if active
      _zc.copy(Z_BLACK).lerp(Z_BRASS, ov < 0.99 ? 0.25 : 0.0);
      if (!active) _zc.lerp(Z_RUST, 0.4);
      col[i * 3] = _zc.r; col[i * 3 + 1] = _zc.g; col[i * 3 + 2] = _zc.b;
      av[i * 3] = active ? ov : 0.5; av[i * 3 + 1] = 0; av[i * 3 + 2] = active ? 1 : 0;
      continue;
    }
    const heat = heatOf(s);
    zone(_zo, s, p.getY(i), n.getX(i), n.getY(i), n.getZ(i), heat, dead, ph);
    col[i * 3] = _zo.r; col[i * 3 + 1] = _zo.g; col[i * 3 + 2] = _zo.b;
    av[i * 3] = heat; av[i * 3 + 1] = _zo.mat; av[i * 3 + 2] = _zo.glit;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aVent', new THREE.BufferAttribute(av, 3));
  delete g.userData.meta;
  return g;
}

// Plain painter for loose pieces (rubble, apron, cones, crust): colour + aVent from
// world position/normal with a fixed heat.
function paintLoose(g, heat, dead, ph, matBoost = 0) {
  const p = g.attributes.position, n = g.attributes.normal, c = p.count;
  const col = new Float32Array(c * 3), av = new Float32Array(c * 3);
  for (let i = 0; i < c; i++) {
    zone(_zo, 0, p.getY(i), n.getX(i), n.getY(i), n.getZ(i), heat, dead, ph + p.getX(i) * 0.37);
    col[i * 3] = _zo.r; col[i * 3 + 1] = _zo.g; col[i * 3 + 2] = _zo.b;
    av[i * 3] = heat; av[i * 3 + 1] = clamp(_zo.mat + matBoost * clamp(n.getY(i), 0, 1), 0, 1); av[i * 3 + 2] = 0;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aVent', new THREE.BufferAttribute(av, 3));
  return g;
}

// Ring heights for a stem: uniform, plus a tight cluster round every flange so the
// shelf's sharp top edge and drooping underside are actually resolved.
function stemRings(n, flanges, H) {
  const ss = [];
  for (let j = 0; j <= n; j++) ss.push(j / n);
  for (const f of flanges) for (const d of [-0.55, -0.25, -0.08, 0.0, 0.07, 0.16]) {
    const s = f.s + d / H;
    if (s > 0.02 && s < 0.98) ss.push(s);
  }
  ss.sort((a, b) => a - b);
  const out = [ss[0]];
  for (let j = 1; j < ss.length; j++) if (ss[j] - out[out.length - 1] > 0.004) out.push(ss[j]);
  return out;
}

// Wall radius with nodular lobes, a flared foot, shelf flanges and a fluted throat.
function wallFn(rAt, H, flanges, seed, fluted, foot) {
  return (s, a) => {
    let r = rAt(s);
    const y = s * H;
    r *= 1 + 0.17 * (vnoise(a * 1.35 + seed, y * 0.55 + seed * 2.3) - 0.5) * 2 + 0.09 * (vnoise(a * 3.1 - seed, y * 1.3) - 0.5) * 2
      + 0.05 * (vnoise(a * 6.0 + seed, y * 3.1) - 0.5) * 2;
    if (foot) r *= 1 + 0.55 * Math.pow(Math.max(0, 1 - s / 0.09), 2);
    for (const f of flanges) {
      const d = y - f.s * H;
      const prof = d > 0 ? Math.exp(-(d * d) / (0.07 * 0.07)) : Math.exp(-(d * d) / (0.45 * 0.45));
      let da = Math.abs(((a - f.a) % TAU + TAU + Math.PI) % TAU - Math.PI);
      const sect = 1 - clamp((da - f.spread) / 0.5, 0, 1);
      r += f.w * prof * sect * (0.35 + 0.8 * vnoise(a * 3.3 + f.a, f.s * 9) + 0.35 * vnoise(a * 9.1 - f.a, f.s * 5));
    }
    if (fluted) r *= 1 + 0.085 * Math.cos(a * 7 + seed) * clamp((s - 0.8) / 0.2, 0, 1);
    return r;
  };
}

// Icosahedron geometry is non-indexed: weld coincident vertices so it shades smooth.
function weldGeo(g) {
  const p = g.attributes.position, map = new Map(), pos = [], idx = [];
  for (let k = 0; k < p.count; k++) {
    const key = Math.round(p.getX(k) * 4096) + ',' + Math.round(p.getY(k) * 4096) + ',' + Math.round(p.getZ(k) * 4096);
    let i = map.get(key);
    if (i === undefined) { i = pos.length / 3; map.set(key, i); pos.push(p.getX(k), p.getY(k), p.getZ(k)); }
    idx.push(i);
  }
  g.dispose();
  const w = new THREE.BufferGeometry();
  w.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  w.setIndex(idx);
  return w;
}

// Replays the shipped spine arithmetic (identical draws, identical order) and returns the
// spine points, radii and the fork's spine; the throat is the final point.
function planChimney(baseX, baseY, baseZ, height, dead, forked) {
  const segs = dead ? 3 + ((rnd() * 2) | 0) : 5 + ((rnd() * 3) | 0);
  const baseR = dead ? rng(0.9, 1.5) : rng(1.3, 2.4);
  let x = baseX, y = baseY, z = baseZ, tiltX = 0, tiltZ = 0;
  const pts = [new THREE.Vector3(x, y, z)], rads = [];
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const segH = (height / segs) * rng(0.82, 1.24);
    const r0 = Math.max(baseR * (1 - t0 * 0.80) + 0.10, 0.06);
    const r1 = Math.max(baseR * (1 - t1 * 0.80) + 0.08, 0.05);
    rnd();   // jitter (shipped draw, now unused: the wall noise is local)
    tiltX += rng(-0.10, 0.10) + (dead ? rng(0, 0.16) : 0);
    tiltZ += rng(-0.10, 0.10) + (dead ? rng(-0.08, 0.08) : 0);
    rng(0, TAU);   // ry (shipped draw)
    if (i === 0) rads.push(r0);
    rads.push(r1);
    x += Math.sin(tiltZ) * segH * 0.5;
    z -= Math.sin(tiltX) * segH * 0.5;
    y += segH * Math.cos((Math.abs(tiltX) + Math.abs(tiltZ)) * 0.5);
    pts.push(new THREE.Vector3(x, y, z));
  }
  let fork = null;
  if (forked) {
    let fx = baseX + (x - baseX) * 0.55, fy = baseY + (y - baseY) * 0.55, fz = baseZ + (z - baseZ) * 0.55;
    let ftx = tiltX * 0.55 + rng(0.25, 0.5), ftz = tiltZ * 0.55 + rng(-0.35, 0.35);
    const fsegs = 3, fBaseR = baseR * 0.55;
    const fp = [new THREE.Vector3(fx, fy, fz)], fr = [];
    for (let i = 0; i < fsegs; i++) {
      const segH = (height * 0.35 / fsegs) * rng(0.85, 1.2);
      const r0 = Math.max(fBaseR * (1 - (i / fsegs) * 0.7) + 0.08, 0.05);
      const r1 = Math.max(fBaseR * (1 - ((i + 1) / fsegs) * 0.7) + 0.06, 0.04);
      rnd();   // jitter
      ftx += rng(-0.06, 0.06); ftz += rng(-0.06, 0.06);
      rng(0, TAU);   // fry
      if (i === 0) fr.push(r0);
      fr.push(r1);
      // the old fork leaned by its Euler tilt; follow the same lean with its spine
      fx += Math.sin(ftz) * segH * 0.5 + Math.sin(ftz) * segH * 0.5;
      fz -= Math.sin(ftx) * segH * 0.5 + Math.sin(ftx) * segH * 0.5;
      fy += segH * 0.94;
      fp.push(new THREE.Vector3(fx, fy, fz));
    }
    fork = { pts: fp, rads: fr };
  }
  return { x, y, z, baseR, pts, rads, fork, height };
}

function radiusAlong(rads) {
  const n = rads.length - 1;
  return s => { const f = clamp(s, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), t = f - i; return rads[i] + (rads[i + 1] - rads[i]) * t; };
}

// One chimney: main stem (+ fork), secondary spires, talus apron, fallen rubble.
function buildChimney(part, mat, baseX, baseY, baseZ, height, dead, forked, active, seed) {
  const P = planChimney(baseX, baseY, baseZ, height, dead, forked);
  const R = localRng(seedOf(baseX, baseZ, seed * 131));
  const ph = R() * 10;
  // main stem: sink the foot a little below the seabed so a slope never shows daylight
  const spine = P.pts.map(p => p.clone());
  spine[0].y -= 0.35;
  const curve = new THREE.CatmullRomCurve3(spine, false, 'centripetal');
  const H = P.y - baseY;
  const flanges = [];
  if (!dead) {
    const nf = 1 + ((R() * 2.6) | 0);
    for (let k = 0; k < nf; k++) flanges.push({ s: 0.25 + R() * 0.55, a: R() * TAU, spread: 0.3 + R() * 0.8, w: P.baseR * (0.2 + R() * 0.3) });
  }
  const rMain = radiusAlong(P.rads);
  const wall = wallFn(rMain, H, flanges, seed * 0.37 + ph, active, true);
  const ss = stemRings(Math.max(12, Math.round(H * 2.6)), flanges, H);
  const sides = 18;
  const jagPh = R() * TAU;
  const g = stemGeo(curve, ss, sides, wall, {
    top: dead ? 'broken' : 'bore', boreDepth: dead ? 0.35 : 1.3,
    jag: a => -Math.abs(Math.sin(a * 2.5 + jagPh)) * 0.55 - vnoise(a * 3 + jagPh, 1.7) * 0.4
  });
  paintStem(g, s => (active ? 0.9 * Math.pow(s, 1.15) : 0.15 * s), dead, active, ph);
  part.add(g, mat);
  if (P.fork) {
    const fc = new THREE.CatmullRomCurve3(P.fork.pts.map((p, i) => i === 0 ? p.clone().lerp(P.fork.pts[1], -0.25) : p.clone()), false, 'centripetal');
    const fH = P.fork.pts[P.fork.pts.length - 1].y - P.fork.pts[0].y;
    const fw = wallFn(radiusAlong(P.fork.rads), fH, [], seed * 0.53 + 3, active, false);
    const fg = stemGeo(fc, stemRings(10, [], fH), 12, fw, { top: 'bore', boreDepth: 0.6 });
    paintStem(fg, s => (active ? 0.5 + 0.35 * s : 0.1), false, active, ph + 2);
    part.add(fg, mat);
  }
  // secondary spires round the foot: thin beehive stacks, most of them extinct
  const nSp = dead ? ((R() < 0.4) ? 1 : 0) : 2 + ((R() * 2) | 0);
  for (let k = 0; k < nSp; k++) {
    const a = R() * TAU, d = P.baseR * (1.3 + R() * 1.4);
    const sx = baseX + Math.cos(a) * d, sz = baseZ + Math.sin(a) * d;
    const sy = terrainH(sx, sz, ZI);
    const sh = 0.9 + R() * (active ? 2.8 : 1.4), sr = 0.18 + R() * 0.3;
    const lean = 0.12 + R() * 0.2;
    const p0 = new THREE.Vector3(sx, sy - 0.25, sz);
    const p1 = new THREE.Vector3(sx + Math.cos(a) * sh * lean * 0.4, sy + sh * 0.5, sz + Math.sin(a) * sh * lean * 0.4);
    const p2 = new THREE.Vector3(sx + Math.cos(a) * sh * lean, sy + sh, sz + Math.sin(a) * sh * lean);
    const sc = new THREE.CatmullRomCurve3([p0, p1, p2]);
    const spr = s => sr * (1.35 - 0.75 * s);
    const hotSp = active && R() < 0.35;
    const sg = stemGeo(sc, stemRings(9, [], sh), 10, wallFn(spr, sh, [], seed + k * 7.7, false, true), { top: hotSp ? 'bore' : 'cap', boreDepth: 0.3 });
    paintStem(sg, s => (hotSp ? 0.3 + 0.55 * s : 0.08 + 0.1 * s), !hotSp && R() < 0.5, hotSp, ph + k);
    part.add(sg, mat);
  }
  // talus apron: a low mound of shed sulphide skirting the foot, draped on the seabed
  {
    const NA = 24, NR = 4, pos = [], idx = [];
    const R0 = P.baseR * 1.05, R1 = P.baseR * (2.3 + R() * 0.8);
    for (let j = 0; j <= NR; j++) {
      const u = j / NR;
      for (let k = 0; k < NA; k++) {
        const a = k / NA * TAU;
        const rr = (R0 + (R1 - R0) * u) * (1 + 0.22 * (vnoise(a * 1.7 + ph, u * 2) - 0.5) * 2);
        const x = baseX + Math.cos(a) * rr, z = baseZ + Math.sin(a) * rr;
        const lift = (1 - u) * (1 - u) * P.baseR * (0.55 + 0.35 * vnoise(a * 2.9 - ph, 0.3)) + (u === 1 ? -0.3 : 0.03 + 0.1 * (vnoise(a * 7 + ph, u * 5) - 0.5));
        pos.push(x, terrainH(x, z, ZI) + lift, z);
      }
    }
    for (let j = 0; j < NR; j++) for (let k = 0; k < NA; k++) {
      const a = j * NA + k, b = j * NA + (k + 1) % NA, c = a + NA, d = b + NA;
      idx.push(a, b, c, b, d, c);
    }
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    ag.setIndex(idx); ag.computeVertexNormals();
    if (ag.attributes.normal.getY(NA) < 0) { const ix = ag.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } ag.computeVertexNormals(); }
    paintLoose(ag, active ? 0.12 : 0.02, false, ph + 5, 0.25);
    part.add(ag, mat);
  }
  // fallen rubble: snapped chimney sections and angular crust blocks, strewn mostly
  // down one side (where the old stack fell), bedded into the talus
  {
    const fallA = R() * TAU, n = dead ? 9 + ((R() * 5) | 0) : 5 + ((R() * 5) | 0);
    for (let k = 0; k < n; k++) {
      const a = fallA + (R() - 0.5) * (k < n * 0.6 ? 1.3 : 5.5);
      const d = P.baseR * (1.2 + R() * (dead ? 3.2 : 2.4));
      const rx = baseX + Math.cos(a) * d, rz = baseZ + Math.sin(a) * d;
      const ry0 = terrainH(rx, rz, ZI);
      let pg;
      if (R() < 0.55) {
        // a snapped section: short jagged-ended tube lying on its side
        const len = 0.5 + R() * 1.4, rad = P.baseR * (0.18 + R() * 0.3);
        pg = new THREE.CylinderGeometry(rad * (0.8 + R() * 0.3), rad, len, 8, 2, false);
        const pp = pg.attributes.position;
        for (let v = 0; v < pp.count; v++) {
          const yy = pp.getY(v), ang = Math.atan2(pp.getZ(v), pp.getX(v));
          const jag = Math.abs(yy) > len * 0.49 ? (Math.sin(ang * 3 + k) * 0.18 + (R() - 0.5) * 0.12) * rad * 1.5 : 0;
          const kn = 1 + 0.12 * (vnoise(ang * 1.5 + k, yy * 2) - 0.5) * 2;
          pp.setXYZ(v, pp.getX(v) * kn, yy + Math.sign(yy) * jag, pp.getZ(v) * kn);
        }
        pg.rotateZ(Math.PI / 2 + (R() - 0.5) * 0.5).rotateY(R() * TAU);
        pg.translate(rx, ry0 + rad * 0.55, rz);
      } else {
        // an angular crust block
        const s0 = P.baseR * (0.15 + R() * 0.35);
        pg = weldGeo(new THREE.IcosahedronGeometry(1, 1));
        const pp = pg.attributes.position;
        const sx = 0.7 + R() * 0.8, sy = 0.45 + R() * 0.5, sz = 0.7 + R() * 0.8, bs = R() * 20;
        for (let v = 0; v < pp.count; v++) {
          const x0 = pp.getX(v), y0 = pp.getY(v), z0 = pp.getZ(v);
          // lumpy, with one flat snapped face
          const lump = 1 + 0.28 * (vnoise(x0 * 2.1 + bs, z0 * 2.1 + y0 * 1.7) - 0.5) * 2;
          const yy = Math.max(y0 * lump, -0.35);
          pp.setXYZ(v, x0 * lump * sx * s0, yy * sy * s0, z0 * lump * sz * s0);
        }
        pg.rotateY(R() * TAU).rotateX((R() - 0.5) * 0.6);
        pg.translate(rx, ry0 + s0 * sy * 0.3, rz);
      }
      if (pg.attributes.uv) pg.deleteAttribute('uv');
      pg.computeVertexNormals();
      paintLoose(pg, 0.05, R() < 0.3, ph + k * 1.3, 0.0);
      part.add(pg, mat);
    }
  }
  return { x: P.x, y: P.y, z: P.z, baseR: P.baseR };
}

function buildFumarole(part, mat, x, z, zi) {
  const y = terrainH(x, z, zi), n = terrainNormal(x, z, zi);
  const h = rng(0.35, 0.85), r = h * rng(0.5, 0.9);
  const yaw = rnd() * TAU;
  // a squat beehive vent, grown like the spires (same draws as the shipped cone)
  const R = localRng(seedOf(x, z, 7));
  const p0 = new THREE.Vector3(x, y - 0.1, z), p2 = new THREE.Vector3(x + n.x * h * 0.5, y + h * 1.4, z + n.z * h * 0.5);
  const c = new THREE.CatmullRomCurve3([p0, p0.clone().lerp(p2, 0.5), p2]);
  const g = stemGeo(c, stemRings(5, [], h * 1.4), 10, wallFn(s => r * (1.1 - 0.75 * s), h * 1.4, [], yaw, false, true), { top: 'bore', boreDepth: 0.25 });
  paintStem(g, s => 0.25 + 0.5 * s, R() < 0.3, true, yaw);
  part.add(g, mat);
}

function buildCrust(part, mat, x, z, zi) {
  const r = rng(1.2, 2.8);
  rnd();                       // yaw (shipped draw)
  const dead = rnd() < 0.5;
  // an irregular crust plate draped on the seabed, its rim lifted and cracked
  const NA = 12, pos = [], idx = [];
  const cy = terrainH(x, z, zi);
  pos.push(x, cy + 0.06, z);
  for (let j = 1; j <= 2; j++) for (let k = 0; k < NA; k++) {
    const a = k / NA * TAU, rr = r * (j / 2) * (0.75 + 0.5 * vnoise(a * 1.9 + x, j + z * 0.1));
    const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
    pos.push(px, terrainH(px, pz, zi) + (j === 1 ? 0.08 : 0.02), pz);
  }
  for (let k = 0; k < NA; k++) idx.push(0, 1 + (k + 1) % NA, 1 + k);
  for (let k = 0; k < NA; k++) { const a = 1 + k, b = 1 + (k + 1) % NA, c = a + NA, d = b + NA; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
  paintLoose(g, dead ? 0.02 : 0.2, dead, x * 0.1, 0.18);
  part.add(g, mat);
}

// ------------------------------------------------------------------- material ---
// The ONE chimney material (created once, reused by every reseed — zero recompiles).
// Structure comes from the generated sulphide set (lib/textures.js sulphideSet),
// projected triplanar in world space at two scales (the merged mesh has no UVs worth
// the name); hue is the baked vertex zoning. On top:
//   BACTERIAL MATS (aVent.y): chalky white-cream fleece, matte, with a soft fibrous
//     breakup, pooled on lee faces and under the flanges.
//   GLITTER (aVent.z x map A): near the throat a sparse set of crystal facets turn into
//     brassy near-mirrors (low roughness, metallic) — the vent light and the lantern
//     strike points of fire in the crust. Fades with range so it never sparkles.
//   HEAT (aVent.x): the bore (x ~ 1) of an active throat carries a dim ember in its
//     depths — vertex warmth, not a light (the one shared PointLight rule holds).
function buildChimneyMat() {
  const SS = sulphideSet();
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0.02 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uSulPack = { value: SS.pack };
    sh.uniforms.uSulNrm = { value: SS.nrm };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aVent;\nvarying vec3 vVent;\nvarying vec3 vVWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVent = aVent;\nvVWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uSulPack, uSulNrm;
varying vec3 vVent;
varying vec3 vVWP;
vec4 sulTri(vec3 p, vec3 bw, float f) {
  return texture2D(uSulPack, p.zy * f) * bw.x + texture2D(uSulPack, p.xz * f) * bw.y + texture2D(uSulPack, p.xy * f) * bw.z;
}
vec3 sulNrm(vec3 p, vec3 n, vec3 bw, float f, float str) {
  vec3 tx = texture2D(uSulNrm, p.zy * f).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(uSulNrm, p.xz * f).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(uSulNrm, p.xy * f).xyz * 2.0 - 1.0;
  vec3 wx = vec3(tx.xy * str + n.zy, abs(tx.z) * n.x);
  vec3 wy = vec3(ty.xy * str + n.xz, abs(ty.z) * n.y);
  vec3 wz = vec3(tz.xy * str + n.xy, abs(tz.z) * n.z);
  return normalize(wx.zyx * bw.x + wy.xzy * bw.y + wz.xyz * bw.z);
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
float ventGlit = 0.0;
float ventMat = 0.0;
{
  vec3 wN = normalize(inverseTransformDirection(normal, viewMatrix));
  vec3 bw = pow(abs(wN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
  // two incommensurate scales: crystal grain (~1.6 u a tile) and nodular growth (~6.1 u)
  vec4 pd = sulTri(vVWP, bw, 0.62);
  vec4 pc = sulTri(vVWP + vec3(3.1, 7.7, 1.3), bw, 0.165);
  float fw = length(fwidth(vVWP));
  float res = 1.0 - smoothstep(0.02, 0.09, fw);
  vec3 wN2 = sulNrm(vVWP, wN, bw, 0.62, 1.0 * res);
  wN2 = normalize(mix(wN2, sulNrm(vVWP + vec3(3.1, 7.7, 1.3), wN, bw, 0.165, 0.9), 0.4));
  // mats are soft fleece: they swallow the crystal relief
  ventMat = smoothstep(0.15, 0.6, vVent.y * (0.55 + 0.9 * pc.b) - 0.1 * pd.b);
  normal = normalize((viewMatrix * vec4(normalize(mix(wN2, wN, ventMat * 0.8)), 0.0)).xyz);
  float albM = pd.r * 1.275 * mix(1.0, pc.r * 1.275, 0.5);
  diffuseColor.rgb *= albM;
  // fibrous mat breakup: a finer mottling of the fleece
  vec3 matC = vec3(0.46, 0.45, 0.40) * (0.7 + 0.4 * pd.b + 0.2 * pc.g);
  diffuseColor.rgb = mix(diffuseColor.rgb, matC, ventMat * 0.92);
  ventGlit = pd.a * vVent.z * (1.0 - ventMat) * (1.0 - smoothstep(0.03, 0.12, fw));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.33, 0.17), ventGlit);
  // cavity: pores and cracks go dark
  diffuseColor.rgb *= mix(1.0, 0.55 + 0.45 * pd.b * 1.6, 0.6 * res);
  roughnessFactor = mix(clamp(mix(pd.g, pc.g, 0.35) * 1.05, 0.45, 1.0), 1.0, ventMat);
}`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  // the crystalline facets: near-mirror brassy chalcopyrite
  roughnessFactor = mix(roughnessFactor, 0.16, ventGlit);
  metalnessFactor = mix(metalnessFactor, 0.85, ventGlit);
  // the bore of an active throat: a dim ember deep inside
  float bore = smoothstep(0.985, 1.0, vVent.x);
  totalEmissiveRadiance += vec3(0.55, 0.16, 0.04) * bore * 0.55;
}`);
  };
  m.customProgramCacheKey = () => 'vents|chimney';
  return m;
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
export const ventColliders = [];
let built = false;

const uni = { uTime: { value: 0 }, uVis: { value: 0 }, uFogD: { value: 0.01 } };
let plumePts = null, shimmerPts = null, ventLight = null;
let root = null;          // the merged chimney/fumarole/crust group — disposed+regrown on reseed
let chimneyMat = null;    // the ONE MeshStandardMaterial every solid piece shares — REUSED across reseeds, never recreated (zero recompiles)
export const activeVents = [];   // {x,y,z,baseR} throat positions, non-dead — ventlife.js anchors its swarms here (array keeps identity across reseeds)
const hotVents = [];      // {x,y,z,sprite} the 2-3 hottest — shimmer + ember glow
// THE WARM COLUMNS, uniform-shaped for water.js's marine snow: flat (x, throatY, z,
// radius) per active throat, up to VENT_COLS_MAX, in ONE Float32Array allocated here
// once and rewritten in place by every reseed (the snow material holds this exact
// object as its uniform value, so there is nothing to re-hand over and nothing
// allocated per frame or per voyage). ventColumnCount is the live count in
// {value} form for the same reason — it IS the uniform.
export const VENT_COLS_MAX = 20;
export const ventColumns = new Float32Array(VENT_COLS_MAX * 4);
export const ventColumnCount = { value: 0 };
function publishColumns() {
  const n = Math.min(activeVents.length, VENT_COLS_MAX);
  for (let i = 0; i < n; i++) {
    const v = activeVents[i];
    ventColumns[i * 4] = v.x; ventColumns[i * 4 + 1] = v.y; ventColumns[i * 4 + 2] = v.z;
    // column radius at the throat: the bore's own mouth plus a metre of spread
    ventColumns[i * 4 + 3] = Math.max(1.8, v.baseR * 0.9 + 1.0);
  }
  for (let i = n * 4; i < ventColumns.length; i++) ventColumns[i] = 0;
  ventColumnCount.value = n;
}

// ---------------------------------------------------------------------------
export function buildVents() {
  if (built) return;
  built = true;
  rnd = siteParams('vents').rng;
  growField();
}

// Tear down every accumulator this module owns and regrow against the current site +
// current terrain. The chimney material and the shared PointLight are the two things
// that must survive untouched (material: zero recompiles; light: scene light-count is
// fixed for the game's whole life, see the buildVents comment below on ventLight).
export function reseedVents() {
  if (!built) { buildVents(); return; }

  if (root) {
    root.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); // material is chimneyMat — reused, not touched
    scene.remove(root);
    root = null;
  }
  if (plumePts) {
    plumePts.geometry.dispose();
    plumePts.material.dispose();  // cheap ShaderMaterial, no shared textures — safe to recreate
    scene.remove(plumePts);
    plumePts = null;
  }
  if (shimmerPts) {
    shimmerPts.geometry.dispose();
    shimmerPts.material.dispose();
    scene.remove(shimmerPts);
    shimmerPts = null;
  }
  for (const v of hotVents) {
    scene.remove(v.sprite);
    // NEVER dispose v.sprite.material.map: makeGlow() hands out lib/textures.js's
    // module-level shared glowTex, used by every glow sprite in the game. Only the
    // per-sprite SpriteMaterial instance is ours to free.
    v.sprite.material.dispose();
  }
  hotVents.length = 0;
  activeVents.length = 0;
  ventColliders.length = 0;   // in place — player.js/game.js hold this exact array reference

  rnd = siteParams('vents').rng;   // fresh stream per brief: never reuse one across rebuilds
  growField();
}

// The shared placement/plume/shimmer pipeline both buildVents() and reseedVents() run.
// No `built` guard here — callers own that — and it never touches ventLight, which
// lives for the whole game.
function growField() {
  // --- pass 1: cluster centres, deterministic rejection sampling -------------
  const clusters = [];
  for (let ci = 0; ci < N_CLUSTERS; ci++) {
    let found = null;
    for (let tries = 0; tries < 400 && !found; tries++) {
      const a = rnd() * TAU, r = rng(40, 200);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const margin = CLUSTER_R + 6;
      if (Math.hypot(x - RC1.x, z - RC1.z) < RIFT1_CLEAR + margin) continue;
      if (Math.hypot(x - RC0.x, z - RC0.z) < RIFT0_CLEAR + margin) continue;
      if (Math.hypot(x, z) > FIELD_R - margin) continue;
      if (clusters.some(o => Math.hypot(o.x - x, o.z - z) < 55)) continue;
      found = { x, z };
    }
    // Guaranteed to succeed at the shipped seed (verified offline); a null center
    // would just mean one fewer cluster this session, never a rift violation.
    if (found) clusters.push(found);
  }

  // --- pass 2: chimney positions, same rejection rules as the clusters -------
  const chimneys = [];
  for (let ci = 0; ci < clusters.length; ci++) {
    const c = clusters[ci];
    const want = PER_CLUSTER[ci] ?? 4;
    let placed = 0, guard = 0;
    while (placed < want && guard++ < want * 60) {
      const a = rnd() * TAU, r = Math.sqrt(rnd()) * CLUSTER_R;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (Math.hypot(x - RC1.x, z - RC1.z) < RIFT1_CLEAR) continue;
      if (Math.hypot(x - RC0.x, z - RC0.z) < RIFT0_CLEAR) continue;
      if (Math.hypot(x, z) > FIELD_R) continue;
      const n = terrainNormal(x, z, ZI);
      if (n.y < SLOPE_MIN_NY) continue;
      chimneys.push({ ci, x, y: terrainH(x, z, ZI), z });
      placed++;
    }
  }

  // --- pass 3: per-chimney attributes (height/dead/forked), then rank "hot" --
  const attrs = chimneys.map(() => {
    const dead = rnd() < 0.28;
    const height = dead ? rng(3, 6) : rng(4, 14);
    const forked = !dead && rnd() < 0.30;
    return { dead, height, forked };
  });
  const activeIdx = attrs.map((a, i) => i).filter(i => !attrs[i].dead)
    .sort((i, j) => attrs[j].height - attrs[i].height);
  const hotSet = new Set(activeIdx.slice(0, 3));

  // --- pass 4: build geometry + FX ------------------------------------------
  // chimneyMat is created once, ever, and reused on every reseed — a fresh material
  // instance would recompile every mesh that binds it, and reseedVents()'s whole point
  // is zero recompiles.
  if (!chimneyMat) {
    // POLISH-VENTS: generated sulphide crust set + zoning/mats/glitter (buildChimneyMat).
    // Created once with the material — zero reseed churn.
    chimneyMat = buildChimneyMat();
    registerPaint(chimneyMat);   // PAINT LAW (lib/paint.js): crust relief softens with the dial
  }
  const mat = chimneyMat;
  root = new THREE.Group();
  const part = Part(root);

  for (let i = 0; i < chimneys.length; i++) {
    const ch = chimneys[i], A = attrs[i];
    const throat = buildChimney(part, mat, ch.x, ch.y, ch.z, A.height, A.dead, A.forked, !A.dead, i * 97.7 + 3.1);
    if (A.height >= 4) ventColliders.push({ x: ch.x, y: ch.y + A.height * 0.5, z: ch.z, r: Math.max(throat.baseR * 0.85, 0.6) });
    if (!A.dead) {
      activeVents.push(throat);
      if (hotSet.has(i)) {
        const sprite = makeGlow(0xff8248, 0.9);
        sprite.material.opacity = 0;
        // fog OFF, same reasoning as the raft's lantern: the per-channel Beer-Lambert
        // chunk kills red in metres at vent-floor murk, so a warm ember arrived on
        // screen TEAL — the one hue this zone must never glow. Its own 25-unit
        // quadratic distance gate already does the fade honestly.
        sprite.material.fog = false;
        // ABOVE the rim, not inside the bore: recessed 0.4 down, the chimney's own lip
        // depth-tested the glow away the moment you stood close enough to care — the
        // fire was visible at 40 units and gone at 10. Licking just clear of the mouth
        // it reads from every side, which is also just what a vent flame does.
        sprite.position.set(throat.x, throat.y + 0.35, throat.z);
        scene.add(sprite);
        hotVents.push({ x: throat.x, y: throat.y, z: throat.z, sprite });
      }
    }
  }

  // Vent mouths: fumarole cones + cracked crust so the chimneys don't stand on clean sand.
  for (const c of clusters) {
    const nCones = 3 + ((rnd() * 2) | 0), nCrust = 2 + ((rnd() * 2) | 0);
    for (let i = 0; i < nCones; i++) {
      const a = rnd() * TAU, r = rng(3, 15);
      buildFumarole(part, mat, c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, ZI);
    }
    for (let i = 0; i < nCrust; i++) {
      const a = rnd() * TAU, r = rng(2, 15);
      buildCrust(part, mat, c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, ZI);
    }
  }

  part.bake();
  scene.add(root);

  // ONE shared throat light, never three: three.js recompiles every lit material in
  // the scene when the LIGHT COUNT changes, so per-vent lights toggled by zone would
  // hitch the whole game mid-dive. This one is always in the scene (count constant)
  // and rides whichever hot vent is nearest the camera; the vents are ~100+ units
  // apart, so no frame can ever see two lit throats missing their light. It is what
  // makes the ember read as FIRE INSIDE ROCK — warm light on the chimney's own flank
  // and the seabed at its foot — instead of a sticker floating on the bore.
  // Created once and NEVER touched again by a reseed: removing/re-adding it would
  // change the scene's light count for a frame, which recompiles every lit material
  // in the game — exactly what this module exists to avoid.
  if (!ventLight) { ventLight = new THREE.PointLight(0xff7a3c, 0, 13, 2.0); scene.add(ventLight); }

  buildPlumes();
  buildShimmer();
  publishColumns();
}

// ---------------------------------------------------------------------------
// Plumes: dark, slow-rising smoke off every active chimney. One shared Points
// stream, cycle-recycled entirely in the vertex shader (water.js buildBubbles
// idiom) — the CPU touches nothing here after this build call.
// ---------------------------------------------------------------------------
const PLUME_PER_VENT = 26;

function buildPlumes() {
  if (!activeVents.length) return;
  const N = activeVents.length * PLUME_PER_VENT;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), par = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const v = activeVents[i % activeVents.length];
    pos[i * 3] = v.x + rng(-0.5, 0.5);
    pos[i * 3 + 1] = v.y + rng(0, 0.4);
    pos[i * 3 + 2] = v.z + rng(-0.5, 0.5);
    par[i * 4] = rnd();                  // phase — site stream, not Math.random: this module is seeded
    par[i * 4 + 1] = rng(0.55, 1.15);    // cycle-rate variance
    par[i * 4 + 2] = rng(0.55, 1.15);    // size variance
    par[i * 4 + 3] = rng(0, TAU);        // wobble seed
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aParam', new THREE.BufferAttribute(par, 4));

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      uTime: uni.uTime, uVis: uni.uVis, uColor: { value: new THREE.Color(0x231e19) }
    }),
    vertexShader: `
      uniform float uTime, uVis;
      attribute vec4 aParam;
      varying float vA;
      #include <fog_pars_vertex>
      void main(){
        float k = fract(aParam.x + uTime * aParam.y * 0.045);
        float h = k * (2.0 - k);
        vec3 p = position;
        p.y += h * 20.0;
        float wob = (0.5 + h * 2.4) * aParam.y;
        p.x += sin(uTime * 0.42 + aParam.w + h * 5.4) * wob;
        p.z += cos(uTime * 0.35 + aParam.w * 1.6 + h * 4.7) * wob;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        float dist = -mvPosition.z;
        gl_PointSize = clamp(aParam.z * (9.0 + h * 32.0) / max(dist, 0.6), 2.0, 90.0);
        vA = smoothstep(0.0, 0.10, k) * (1.0 - smoothstep(0.72, 1.0, k)) * uVis;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vA;
      #include <fog_pars_fragment>
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float d = dot(q, q);
        if (d > 0.25) discard;
        float a = exp(-d * 6.0) * vA * 0.55;
        if (a <= 0.004) discard;
        gl_FragColor = vec4(uColor, a);
        #include <fog_fragment>
      }`
  });
  plumePts = new THREE.Points(g, mat);
  plumePts.frustumCulled = false;
  plumePts.visible = false;
  scene.add(plumePts);
}

// ---------------------------------------------------------------------------
// Shimmer: sparse, faint refractive-looking sprites over the 2-3 hottest vents.
// Additive but deliberately dim (creatures.js sparks idiom) and manually faded by
// scene.fog.density — additive materials must fade to black with range, never
// toward the fog colour, or they read as neon at distance.
// ---------------------------------------------------------------------------
const SHIMMER_PER_VENT = 24;

function buildShimmer() {
  if (!hotVents.length) return;
  const N = hotVents.length * SHIMMER_PER_VENT;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), par = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const v = hotVents[i % hotVents.length];
    pos[i * 3] = v.x + rng(-0.25, 0.25);
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z + rng(-0.25, 0.25);
    par[i * 4] = rnd();   // site stream, not Math.random: this module is seeded
    par[i * 4 + 1] = rng(0.7, 1.3);
    par[i * 4 + 2] = rng(0.5, 1.0);
    par[i * 4 + 3] = rng(0, TAU);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aParam', new THREE.BufferAttribute(par, 4));

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: uni.uTime, uVis: uni.uVis, uFogD: uni.uFogD, uColor: { value: new THREE.Color(0xbfe0ea) } },
    vertexShader: `
      uniform float uTime, uVis, uFogD;
      attribute vec4 aParam;
      varying float vA;
      float fogVis(vec3 wp){ float d = length(wp - cameraPosition); return exp(-uFogD*uFogD*d*d); }
      void main(){
        float k = fract(aParam.x + uTime * aParam.y * 0.14);
        vec3 p = position;
        p.y += k * 22.0;
        float wob = 0.15 + k * 0.5;
        p.x += sin(uTime * 1.3 + aParam.w + k * 8.0) * wob;
        p.z += cos(uTime * 1.1 + aParam.w * 1.3 + k * 7.0) * wob;
        vec4 wp4 = modelMatrix * vec4(p, 1.0);
        vec4 mvPosition = viewMatrix * wp4;
        float dist = -mvPosition.z;
        gl_PointSize = clamp(aParam.z * 60.0 / max(dist, 0.6), 1.0, 14.0);
        vA = smoothstep(0.0, 0.08, k) * (1.0 - smoothstep(0.65, 1.0, k)) * uVis * fogVis(wp4.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vA;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float d = dot(q, q);
        if (d > 0.25) discard;
        float a = exp(-d * 9.0) * vA * 0.10;
        if (a <= 0.003) discard;
        gl_FragColor = vec4(uColor, a);
      }`
  });
  shimmerPts = new THREE.Points(g, mat);
  shimmerPts.frustumCulled = false;
  shimmerPts.visible = false;
  scene.add(shimmerPts);
}

// ---------------------------------------------------------------------------
// frame: two shared floats (uTime, uVis) plus a per-hot-vent distance test (at
// most 3 sqrts). No allocation — every temp below is a bare number.
// ---------------------------------------------------------------------------
const FADE_IN0 = -280, FADE_IN1 = -350, FADE_OUT0 = -570, FADE_OUT1 = -620;

export function updateVents(dt, t) {
  if (!built) return;
  uni.uTime.value = t;
  if (scene.fog) uni.uFogD.value = scene.fog.density;

  const camY = camera.position.y;
  const inK = clamp((FADE_IN0 - camY) / (FADE_IN0 - FADE_IN1), 0, 1);
  const outK = clamp((camY - FADE_OUT1) / (FADE_OUT0 - FADE_OUT1), 0, 1);
  const vis = Math.min(inK, outK);
  uni.uVis.value = vis;

  const awake = camY < FADE_IN0 && camY > FADE_OUT1;
  if (plumePts) plumePts.visible = awake;
  if (shimmerPts) shimmerPts.visible = awake;

  let bestD = 1e9, best = -1;
  for (let i = 0; i < hotVents.length; i++) {
    const v = hotVents[i];
    const dx = camera.position.x - v.x, dy = camera.position.y - v.y, dz = camera.position.z - v.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < bestD) { bestD = dist; best = i; }
    // Two ranges, one ember. Out to ~90 units it is a faint warm point in the murk —
    // zone 1's only wayfinding, the way the raft lamp is the surface's — and inside
    // 25 it swells into the fire in the bore. Measured before this: at 12 units from
    // a chimney the frame was EMPTY; unlit rock in vent-floor murk is invisible, so
    // a 25-unit gate meant the field could only be discovered by collision.
    const far = clamp(1 - dist / 90, 0, 1);
    const near = clamp(1 - dist / 25, 0, 1);
    // far is LINEAR, not squared: squared put a 50-unit ember at alpha 0.03, which is
    // below the film grain's own noise floor — measured invisible. 0.10-0.12 at that
    // range is a presence the eye finds without the frame ever calling attention to it.
    v.sprite.material.opacity = (far * 0.22 + near * near * 0.30) * vis
      * (0.85 + 0.15 * Math.sin(t * 1.7 + i * 2.1));
    // A light in murk grows a scattering halo with range — that is what fog does to a
    // lamp — so the sprite swells as the fire itself shrinks below resolvability. At
    // 0.9 fixed it was two invisible pixels from 45 units out.
    v.sprite.scale.setScalar(0.9 + dist * 0.075);
  }
  // The shared light follows the nearest hot throat. Slow uneven flicker — a vent
  // breathes, it does not strobe — and the same 25-unit approach curve as the sprite,
  // so light and glow arrive together.
  if (ventLight && best >= 0) {
    const v = hotVents[best];
    ventLight.position.set(v.x, v.y + 0.3, v.z);
    // Linear over 34 units, not squared over 25: the camera trails the diver by ~10,
    // so the squared curve had the throat at 6% intensity while Sal stood right beside
    // it. The light should arrive with the man, not with the lens.
    const near = clamp(1 - bestD / 34, 0, 1);
    ventLight.intensity = 6.5 * near * vis *
      (0.80 + 0.14 * Math.sin(t * 1.7 + best * 2.1) + 0.06 * Math.sin(t * 5.3));
  }
}
