// Kelp forests, reef communities, eroded boulders. OWNED BY: flora agent.
// All motion happens in the vertex shader (instanced attributes), so updateFlora()
// costs only a handful of uniform writes regardless of instance count.
import * as THREE from 'three';
import { scene, camera, envTexDeep as envTex } from '../core.js';
import { WORLD_R, RIFT_R, riftPos, zoneTop, zoneBottom } from '../config.js';
import { rng, V3, clamp, fbm } from '../lib/math.js';
import { makeGlow } from '../lib/textures.js';
import { terrainH, terrainNormal } from './terrain.js';
import { wreckSites } from './wrecks.js';
import { siteParams } from './site.js';

const TAU = Math.PI * 2;

// Build-scoped random stream (THE CHART's reseed path). buildFlora()/reseedFlora()
// install a fresh `siteParams('flora').rng` here before touching anything else, so
// every placement/orientation/scale/shape call below becomes a pure function of the
// site instead of the latent Math.random() nondeterminism this used to run on.
// `scatter()` is the one exemption (see its own comment): it keeps lib/math.js's
// Math.random-backed `rng`, unchanged, for water.js's bubble vents.
let _fr = Math.random;
const rr = (a, b) => a + _fr() * (b - a);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = V3(0, 1, 0), IDQ = new THREE.Quaternion();
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Keep-out test against the zone's wreck site, so scatter never crowds the hulls.
// The sites are deterministic, so this works whether or not wrecks have built yet.
const WRECK_MARGIN = 4;
function nearWreck(zi, x, z) {
  const w = wreckSites()[zi];
  const d = w.clear + WRECK_MARGIN;
  return (x - w.x) * (x - w.x) + (z - w.z) * (z - w.z) < d * d;
}

// Rejection-sampled placement on the terrain, keeping clear of the rift funnel.
export function scatter(count, zi, minR, maxR) {
  const pts = [];
  let guard = 0;
  while (pts.length < count && guard++ < count * 30) {
    const a = Math.random() * Math.PI * 2, r = rng(minR, maxR);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const rp = riftPos(zi);
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_R * 2.6) continue;
    if (nearWreck(zi, x, z)) continue;
    pts.push(V3(x, terrainH(x, z, zi), z));
  }
  return pts;
}

// ---- 3D value noise, for eroding rock silhouettes ----
const h3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
function n3(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  const u = (t => t * t * (3 - 2 * t))(x - X), v = (t => t * t * (3 - 2 * t))(y - Y), w = (t => t * t * (3 - 2 * t))(z - Z);
  const L = (a, b, t) => a + (b - a) * t;
  return L(
    L(L(h3(X, Y, Z), h3(X + 1, Y, Z), u), L(h3(X, Y + 1, Z), h3(X + 1, Y + 1, Z), u), v),
    L(L(h3(X, Y, Z + 1), h3(X + 1, Y, Z + 1), u), L(h3(X, Y + 1, Z + 1), h3(X + 1, Y + 1, Z + 1), u), v), w);
}

// ---------------------------------------------------------------- shaders ----
// Shared across every flora material so one write per frame animates the world.
const uni = { uTime: { value: 0 }, uCur: { value: new THREE.Vector2(1, 0) } };

const V_HEAD = `
attribute vec4 aVA;     // flex, normalised height, glow mask, part phase
attribute float aFlut;  // local flutter weight (blades, tentacles)
attribute vec4 aInst;   // phase, sway amp, arc-shorten k, glow
uniform float uTime; uniform vec2 uCur; uniform vec2 uCull;
uniform float uSway; uniform float uFreq;
varying vec3 vFlora; varying vec3 vLocal;
#ifdef FLORA_ROCK
  varying vec3 vWPos;
#endif`;

const V_BODY = `
float w = uTime * uFreq + aInst.x;
float s1 = sin(w - aVA.y * 3.1), s2 = sin(w * 1.71 - aVA.y * 5.7 + 1.3);
vec2 d = (uCur * (0.34 + 0.66 * s1) + vec2(-uCur.y, uCur.x) * (0.4 * s2)) * (aInst.y * uSway * aVA.x);
transformed.xz += d;
transformed.y -= dot(d, d) * aInst.z;
#ifdef FLORA_FAN
  transformed.z += sin(uTime * 1.5 + transformed.x * 7.0 + aInst.x) * aVA.x * 0.1;
#endif
if (aFlut > 0.0) {
  float f = w * 2.2 + aVA.w;
  transformed += vec3(sin(f) * 0.7, cos(f * 1.31) * 0.5, sin(f * 0.73 + 2.1) * 0.7) * aFlut;
}
// Distance LOD: collapse the instance to a degenerate point well inside the fog wall.
vec3 iw = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
transformed *= 1.0 - smoothstep(uCull.x, uCull.y, distance(iw, cameraPosition));
vFlora = vec3(aVA.z * aInst.w, aVA.y, aInst.x);
vLocal = position;
#ifdef FLORA_ROCK
  vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#endif`;

const F_HEAD = `
uniform float uTime; uniform vec3 uGlowCol; uniform float uSSS; uniform vec3 uSilt;
varying vec3 vFlora; varying vec3 vLocal;
#ifdef FLORA_ROCK
  varying vec3 vWPos;
  // Cheap 3-axis world-space detail: two bands of interfering sines. No texture fetch,
  // no derivatives — just enough grain that smooth stone still reads as stone up close.
  float rockDet(vec3 w, float f) {
    return sin(w.x * f) * sin(w.z * f * 1.13 + 1.7) + sin(w.y * f * 0.87 + 4.1) * 0.7;
  }
#endif`;

const F_BODY = `
float gmask = vFlora.x;
#ifdef FLORA_ROCK
  // Coarse patchiness (weathering) + fine pitting, both subtle enough to survive fog.
  float rc = rockDet(vWPos, 0.42);
  float rf = rockDet(vWPos, 2.7);
  float mott = 0.5 + 0.5 * sin(rc * 1.9 + rf * 0.45);
  float grain = 0.5 + 0.5 * rf;
  diffuseColor.rgb *= mix(0.80, 1.14, mott) * mix(0.94, 1.06, grain);
  roughnessFactor = clamp(roughnessFactor + (mott - 0.5) * 0.18 - (grain - 0.5) * 0.08, 0.45, 1.0);
#endif
#ifdef FLORA_GROOVE
  float mn = sin(vLocal.x * 27.0 + sin(vLocal.z * 21.0 + vLocal.y * 15.0) * 2.4);
  // Reversed-edge smoothstep is UB (0.0 on this driver): the grooves never drew, and
  // gmask *= gr below silently killed ALL brain-coral bioluminescence with them.
  // 1.0 - smoothstep(lo, hi, x) is the defined form (see water.js foldK).
  float gr = 1.0 - smoothstep(0.0, 0.3, abs(mn));
  diffuseColor.rgb *= mix(1.0, 0.3, gr);
  roughnessFactor = mix(roughnessFactor, 1.0, gr * 0.7);
  gmask *= gr;
#endif
#ifdef FLORA_INNER
  if (!gl_FrontFacing) diffuseColor.rgb *= 0.28;
#endif
#ifdef FLORA_SILT
  float up = inverseTransformDirection(normal, viewMatrix).y;
  diffuseColor.rgb = mix(diffuseColor.rgb, uSilt, smoothstep(0.4, 0.97, up) * 0.5);
  diffuseColor.rgb *= mix(0.4, 1.0, smoothstep(-0.85, 0.15, up));
#endif
#ifdef FLORA_SSS
  float fr = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.0);
  totalEmissiveRadiance += diffuseColor.rgb * uSSS * (0.18 + 0.82 * vFlora.y) * (0.3 + 0.7 * fr);
#endif
totalEmissiveRadiance += uGlowCol * gmask * (0.4 + 0.6 * (0.5 + 0.5 * sin(uTime * 0.9 + vFlora.z * 3.0)));`;

function floraMat(o) {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0,
    side: o.side ?? THREE.FrontSide, flatShading: !!o.flat
  });
  if (o.env) { m.envMap = envTex; m.envMapIntensity = o.env; }
  m.defines = {};
  for (const d of o.def || []) m.defines['FLORA_' + d] = 1;
  const cull = o.cull ?? 105;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni, {
      uCull: { value: new THREE.Vector2(cull * 0.8, cull) },
      uSway: { value: o.sway ?? 0 }, uFreq: { value: o.freq ?? 0.85 },
      uGlowCol: { value: new THREE.Color(o.glow ?? 0x000000) },
      uSSS: { value: o.sss ?? 0 },
      uSilt: { value: new THREE.Color(o.silt ?? 0x2c4152) }
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>' + V_HEAD)
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + V_BODY);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>' + F_HEAD)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{' + F_BODY + '\n}');
  };
  m.customProgramCacheKey = () => 'flora|' + o.key;
  return m;
}

// ------------------------------------------------------------- geometry ------
// Accumulates transformed primitives into one indexed buffer, tagging every vertex
// with the per-part data the sway/glow shaders read.
class Build {
  constructor() { this.p = []; this.n = []; this.i = []; this.meta = []; this.v = 0; }
  add(geo, m, o = {}) {
    const g = geo.clone().applyMatrix4(m);
    const pos = g.attributes.position, nor = g.attributes.normal, c = pos.count;
    for (let k = 0; k < c; k++) {
      this.p.push(pos.getX(k), pos.getY(k), pos.getZ(k));
      this.n.push(nor.getX(k), nor.getY(k), nor.getZ(k));
      this.meta.push(o);
    }
    if (g.index) for (const k of g.index.array) this.i.push(k + this.v);
    else for (let k = 0; k < c; k++) this.i.push(k + this.v);
    this.v += c;
    g.dispose();
    return this;
  }
  done(fn) {
    let lo = Infinity, hi = -Infinity;
    for (let k = 1; k < this.p.length; k += 3) { if (this.p[k] < lo) lo = this.p[k]; if (this.p[k] > hi) hi = this.p[k]; }
    const span = Math.max(1e-4, hi - lo);
    const col = new Float32Array(this.v * 3), va = new Float32Array(this.v * 4), fl = new Float32Array(this.v);
    const o = { c: [1, 1, 1], flex: 0, glow: 0, flut: 0, ph: 0 };
    for (let k = 0; k < this.v; k++) {
      const x = this.p[k * 3], y = this.p[k * 3 + 1], z = this.p[k * 3 + 2], h = (y - lo) / span;
      o.c[0] = o.c[1] = o.c[2] = 1; o.flex = h * h; o.glow = 0; o.flut = 0; o.ph = this.meta[k].ph || 0;
      fn(x, y, z, h, this.meta[k], o);
      col[k * 3] = o.c[0]; col[k * 3 + 1] = o.c[1]; col[k * 3 + 2] = o.c[2];
      va[k * 4] = o.flex; va[k * 4 + 1] = h; va[k * 4 + 2] = o.glow; va[k * 4 + 3] = o.ph;
      fl[k] = o.flut;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aVA', new THREE.BufferAttribute(va, 4));
    g.setAttribute('aFlut', new THREE.BufferAttribute(fl, 1));
    g.setIndex(this.i);
    return g;
  }
}

function xf(px, py, pz, ry = 0, rz = 0, rx = 0, sx = 1, sy = sx, sz = sx) {
  const m = new THREE.Matrix4().makeRotationY(ry);
  if (rz) m.multiply(new THREE.Matrix4().makeRotationZ(rz));
  if (rx) m.multiply(new THREE.Matrix4().makeRotationX(rx));
  m.scale(_s.set(sx, sy, sz));
  m.setPosition(px, py, pz);
  return m;
}

// Ribbon along +Y, tapering, curving toward +Z.
function strapGeo(h, w0, w1, curve, segs = 3) {
  const g = new THREE.PlaneGeometry(1, 1, 1, segs), p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const u = p.getY(k) + 0.5, v = p.getX(k);
    p.setXYZ(k, v * (w0 + (w1 - w0) * u), u * h, curve * u * u);
  }
  g.computeVertexNormals();
  return g;
}

// Kelp blade: extends along +X, droops, ruffled edges (the twist reads as growth).
function bladeGeo(len, w0, w1, droop, segs = 4) {
  const g = new THREE.PlaneGeometry(1, 1, 1, segs), p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const u = p.getY(k) + 0.5, v = p.getX(k);
    const w = w0 + (w1 - w0) * Math.sin(Math.min(1, u * 1.25) * Math.PI * 0.72);
    p.setXYZ(k, u * len, -droop * u * u + Math.sin(u * 13) * 0.02 * v, v * w);
  }
  g.computeVertexNormals();
  return g;
}

function kelpGeo() {
  const B = new Build();
  const stipe = new THREE.CylinderGeometry(0.035, 0.085, 1, 4, 9, true);
  B.add(stipe, xf(0, 0.5, 0), { t: 's' });
  B.add(new THREE.IcosahedronGeometry(0.17, 0), xf(0, 0.035, 0, 0, 0, 0, 1, 0.4, 1), { t: 'h' });
  const NB = 14;
  for (let i = 0; i < NB; i++) {
    const f = 0.1 + (i / NB) * 0.89, a = i * 2.399;
    // canopy bunching: blades lengthen toward the top, as giant kelp does at the surface
    const len = 0.85 * (0.45 + 0.75 * f) * rr(0.8, 1.15);
    const g = bladeGeo(len, 0.07, 0.17, len * 0.34);
    B.add(g, xf(Math.cos(a) * 0.05, f, Math.sin(a) * 0.05, -a, -0.42 + f * 0.75), { t: 'b', ph: _fr() * TAU, len });
    g.dispose();
  }
  stipe.dispose();
  return B.done((x, y, z, h, m, o) => {
    const s = m.t === 'b' ? 0.42 + 0.58 * sstep(0.15, 1, h) : (m.t === 'h' ? 0.2 : 0.24 + 0.38 * h);
    o.c[0] = s * 0.86; o.c[1] = s; o.c[2] = s * 0.6;
    o.flex = m.t === 'h' ? 0 : h * h;
    o.flut = m.t === 'b' ? 0.09 * clamp((Math.hypot(x, z) - 0.06) / m.len, 0, 1) : 0;
    o.glow = m.t === 'b' ? sstep(0.5, 1, h) : 0;
  });
}

function grassGeo() {
  const B = new Build();
  for (let i = 0; i < 7; i++) {
    const a = rr(0, TAU), g = strapGeo(rr(0.6, 1), 0.03, 0.012, rr(0.1, 0.34), 3);
    B.add(g, xf(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04, a, rr(-0.22, 0.22)), { ph: _fr() * TAU });
    g.dispose();
  }
  return B.done((x, y, z, h, m, o) => {
    const s = 0.35 + 0.65 * h;
    o.c[0] = s * 0.7; o.c[1] = s; o.c[2] = s * 0.74;
    o.flut = 0.03 * h; o.glow = sstep(0.65, 1, h);
  });
}

function staghornGeo() {
  const B = new Build();
  const seg = new THREE.CylinderGeometry(0.62, 1, 1, 4, 1, false);
  seg.translate(0, 0.5, 0);
  const grow = (base, len, rad, d) => {
    B.add(seg, base.clone().multiply(new THREE.Matrix4().makeScale(rad, len, rad)), { d });
    if (d >= 2) return;
    const n = d === 0 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const b = base.clone()
        .multiply(new THREE.Matrix4().makeTranslation(0, len * rr(0.7, 0.97), 0))
        .multiply(new THREE.Matrix4().makeRotationY(i / n * TAU + rr(0, 1.3)))
        .multiply(new THREE.Matrix4().makeRotationX(rr(0.35, 0.8)));
      grow(b, len * rr(0.6, 0.8), rad * 0.68, d + 1);
    }
  };
  grow(new THREE.Matrix4(), 0.42, 0.07, 0);
  seg.dispose();
  return B.done((x, y, z, h, m, o) => {
    const t = clamp(m.d * 0.3 + h * 0.55, 0, 1), s = 0.3 + 0.7 * t;
    o.c[0] = s; o.c[1] = s * 0.9; o.c[2] = s * 0.93;
    o.flex = h * h * 0.6; o.glow = sstep(0.7, 1, t);
  });
}

// Flat gorgonian lattice in the XY plane; ripples along local Z (see FLORA_FAN).
function fanGeo() {
  const B = new Build();
  const grow = (x, y, ang, len, w, d) => {
    const g = strapGeo(len, w, w * 0.66, 0, 2);
    const m = new THREE.Matrix4().makeRotationZ(ang);
    m.setPosition(x, y, 0);
    B.add(g, m, { d });
    g.dispose();
    if (d >= 3) return;
    const tx = x - Math.sin(ang) * len, ty = y + Math.cos(ang) * len, n = d === 0 ? 3 : 2;
    for (let i = 0; i < n; i++)
      grow(tx, ty, ang + (i - (n - 1) / 2) * rr(0.34, 0.62), len * rr(0.62, 0.8), w * 0.78, d + 1);
  };
  grow(0, 0, 0, 0.38, 0.03, 0);
  return B.done((x, y, z, h, m, o) => {
    const s = 0.32 + 0.68 * h;
    o.c[0] = s; o.c[1] = s * 0.86; o.c[2] = s * 0.88;
    o.glow = sstep(0.55, 1, h);
  });
}

function brainGeo() {
  const g = new THREE.SphereGeometry(0.5, 16, 9), p = g.attributes.position, sd = rr(0, 90);
  for (let k = 0; k < p.count; k++) {
    let x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    const d = 1 + 0.24 * (n3(x * 5 + sd, y * 5, z * 5 + sd) - 0.5) + 0.1 * (n3(x * 11, y * 11, z * 11) - 0.5);
    p.setXYZ(k, x * d, Math.max(y * d * 0.62, -0.2), z * d);
  }
  g.computeVertexNormals();
  const B = new Build().add(g, xf(0, 0.2, 0));
  g.dispose();
  return B.done((x, y, z, h, m, o) => {
    const s = 0.5 + 0.5 * h;
    o.c[0] = s; o.c[1] = s * 0.95; o.c[2] = s * 0.86;
    o.flex = 0; o.glow = 1;
  });
}

function spongeGeo() {
  const B = new Build();
  for (let i = 0; i < 5; i++) {
    const a = rr(0, TAU), r = rr(0.02, 0.15), hh = rr(0.45, 1), rad = rr(0.055, 0.1);
    const t = new THREE.CylinderGeometry(rad * 0.92, rad * 0.66, hh, 7, 2, true);
    t.translate(0, hh / 2, 0);
    B.add(t, xf(Math.cos(a) * r, 0, Math.sin(a) * r, 0, rr(-0.2, 0.2)), { top: hh });
    t.dispose();
  }
  return B.done((x, y, z, h, m, o) => {
    const s = 0.4 + 0.6 * h;
    o.c[0] = s; o.c[1] = s * 0.82; o.c[2] = s * 0.9;
    o.flex = h * h; o.glow = sstep(0.82, 1, y / m.top);
  });
}

function anemoneGeo() {
  const B = new Build();
  const col = new THREE.CylinderGeometry(0.17, 0.13, 0.3, 8, 1, true);
  col.translate(0, 0.15, 0);
  B.add(col, xf(0, 0, 0), { t: 'c' });
  const disc = new THREE.SphereGeometry(0.17, 8, 3, 0, TAU, 0, Math.PI * 0.5);
  B.add(disc, xf(0, 0.28, 0, 0, 0, 0, 1, 0.4, 1), { t: 'c' });
  for (let i = 0; i < 14; i++) {
    const ring = i < 8 ? 0 : 1, a = (i - (ring ? 8 : 0)) / (ring ? 6 : 8) * TAU + ring * 0.4;
    const r = ring ? 0.08 : 0.15, len = rr(0.3, 0.5);
    const g = strapGeo(len, 0.026, 0.006, rr(0.04, 0.18), 3);
    const m = new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationX(rr(0.45, 1.15)));
    m.setPosition(Math.sin(a) * r, 0.3, Math.cos(a) * r);
    B.add(g, m, { t: 't', ph: _fr() * TAU, bx: Math.sin(a) * r, by: 0.3, bz: Math.cos(a) * r, len });
    g.dispose();
  }
  col.dispose(); disc.dispose();
  return B.done((x, y, z, h, m, o) => {
    if (m.t === 't') {
      const u = clamp(Math.hypot(x - m.bx, y - m.by, z - m.bz) / m.len, 0, 1);
      const s = 0.45 + 0.55 * u;
      o.c[0] = s; o.c[1] = s * 0.95; o.c[2] = s;
      o.flex = u * u; o.flut = 0.05 * u; o.glow = sstep(0.35, 1, u);
    } else {
      const s = 0.3 + 0.3 * h;
      o.c[0] = s * 0.9; o.c[1] = s * 0.8; o.c[2] = s * 0.85;
      o.flex = 0;
    }
  });
}

// IcosahedronGeometry is non-indexed, so computeVertexNormals() on it yields FLAT
// normals no matter how fine the tessellation. Welding coincident vertices into an
// index buffer is what lets a rock read as smooth weathered stone instead of a gem.
function weld(g) {
  const p = g.attributes.position, map = new Map(), pos = [], idx = [];
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    const key = `${Math.round(x * 8192)},${Math.round(y * 8192)},${Math.round(z * 8192)}`;
    let i = map.get(key);
    if (i === undefined) { i = pos.length / 3; map.set(key, i); pos.push(x, y, z); }
    idx.push(i);
  }
  const w = new THREE.BufferGeometry();
  w.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  w.setIndex(idx);
  return w;
}

// Eroded stone. `detail` sets the icosphere subdivision — PolyhedronGeometry emits
// 20*(detail+1)^2 triangles, so the tri budget is quadratic, not exponential.
// Displacement is four octaves: a low-frequency shape warp that breaks the sphere,
// mid-frequency erosion lobes, then two fine grains that survive smooth shading.
function rockGeo(detail, squash, amp) {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  const g = weld(ico);
  ico.dispose();
  const p = g.attributes.position, sd = rr(0, 90), sd2 = rr(0, 90);
  for (let k = 0; k < p.count; k++) {
    let x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    // Shape warp: bend the sphere off-axis before eroding, so no two rocks share a silhouette.
    const wx = x + amp * 0.55 * (n3(x * 0.7 + sd2, y * 0.7, z * 0.7) - 0.5);
    const wz = z + amp * 0.55 * (n3(x * 0.7, y * 0.7, z * 0.7 + sd2) - 0.5);
    const d = 1
      + amp * 0.62 * (n3(wx * 1.15 + sd, y * 1.15, wz * 1.15 + sd) - 0.5)
      + amp * 0.40 * (n3(x * 2.6, y * 2.6 + sd, z * 2.6) - 0.5)
      + amp * 0.17 * (n3(x * 6.3 + sd2, y * 6.3, z * 6.3) - 0.5)
      + amp * 0.07 * (n3(x * 14.7, y * 14.7, z * 14.7 + sd) - 0.5);
    x = wx * d; z = wz * d; y = y * d * squash;
    // Flatten the underside on a smooth ramp (no crease) so the rock beds into the silt.
    y *= 1 - 0.78 * sstep(-0.42, -0.95, y);
    p.setXYZ(k, x, y, z);
  }
  g.computeVertexNormals();
  const B = new Build().add(g, xf(0, 0, 0));
  g.dispose();
  return B.done((x, y, z, h, m, o) => {
    // Broad mineral banding only — fine mottling is done per-pixel in FLORA_ROCK.
    const mot = 0.86 + 0.2 * n3(x * 1.3 + 11, y * 1.3, z * 1.3);
    const s = mot * (0.62 + 0.38 * h);
    o.c[0] = s * 0.96; o.c[1] = s; o.c[2] = s * 1.04;
    o.flex = 0;
  });
}

// -------------------------------------------------------------- placement ----
function seedClusters(zi, n, minR, maxR, seed, thresh, radLo, radHi) {
  const out = [], rp = riftPos(zi);
  let guard = 0;
  while (out.length < n && guard++ < n * 70) {
    const a = _fr() * TAU, r = rr(minR, maxR);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_R * 3) continue;
    if (guard < n * 35 && fbm(x * 0.011 + seed, z * 0.011 - seed) < thresh) continue;
    if (out.some(s => Math.hypot(s[0] - x, s[1] - z) < radLo * 1.05)) continue;
    out.push([x, z, rr(radLo, radHi)]);
  }
  return out;
}

// Clumped sampling with slope gating; relaxes the slope limit if the terrain
// shape starves a species, so a terrain rewrite can never empty the world.
function place(zi, count, seeds, minSlope, maxSlope = 1.01) {
  const out = [], rp = riftPos(zi);
  if (!seeds.length) return out;
  let lo = minSlope, guard = 0, relaxed = false;
  while (out.length < count && guard++ < count * 40) {
    if (!relaxed && guard > count * 18) { relaxed = true; lo = 1 - (1 - lo) * 2.4; }
    const s = seeds[(_fr() * seeds.length) | 0];
    const a = _fr() * TAU, u = Math.pow(_fr(), 0.8);
    if (_fr() < u * 0.5) continue;
    const x = s[0] + Math.cos(a) * s[2] * u, z = s[1] + Math.sin(a) * s[2] * u;
    const r = Math.hypot(x, z);
    if (r > WORLD_R * 0.98 || r < 10) continue;
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_R * 2.4) continue;
    if (nearWreck(zi, x, z)) continue;
    const n = terrainNormal(x, z, zi);
    if (n.y < lo || n.y > maxSlope) continue;
    out.push({ x, z, y: terrainH(x, z, zi), n });
  }
  return out;
}

// ------------------------------------------------------------------ build ----
const PAL = [
  // Rock albedo is deliberately dark: wet stone under a lantern reads by specular
  // highlight, not by brightness. Lighter values made boulders look like pale ice.
  { kelp: [0x3f7a4e, 0x6b7a35, 0x2f6b52, 0x53703f], reef: [0xd8705a, 0xdba055, 0x7fb8c8, 0xc85f7a], glow: 0x5cffc4, silt: 0x2c3d4a, rock: 0x30444d, turfWarm: [0xa8894a, 0x8f7a3a, 0x9a6b35, 0x6b7a35] },
  { kelp: [0x6b4f8c, 0x8a5f96, 0x4a4480, 0x7a4a6e], reef: [0xc060c8, 0x9a5ad8, 0xe07ab0, 0x60c8d8], glow: 0xa878ff, silt: 0x342c47, rock: 0x3a3048, turfWarm: [0x6e5d4a, 0x5a5f45, 0x715a3f, 0x4a4480] },
  { kelp: [0x8c5039, 0x9c6136, 0x7a4030, 0x8a3f45], reef: [0xe0603a, 0xd8a03a, 0xc83a5a, 0xe08a4a], glow: 0xff9455, silt: 0x3e2d26, rock: 0x473633, turfWarm: [0x8a5c35, 0x7a4a30, 0x6b503a, 0x8c5039] }
];

export const kelp = { inst: null, data: [], meshes: [] };

// Sphere colliders for boulders big enough to swallow the camera. The camera probe in
// game.js tests these; pebbles and debris are deliberately excluded to keep it cheap.
export const rockColliders = [];
const zones = [];

function mount(zi, geo, mat, n, shadow) {
  n = Math.max(1, n);
  const g = geo.clone();
  g.setAttribute('aInst', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
  const im = new THREE.InstancedMesh(g, mat, n);
  im.receiveShadow = !!shadow;
  im.frustumCulled = false;
  zones[zi].add(im);
  return im;
}

function put(im, i, q, sx, sy, x, y, z, col, ph, amp, shrink, glow) {
  _m.compose(_p.set(x, y, z), q, _s.set(sx, sy, sx));
  im.setMatrixAt(i, _m);
  im.setColorAt(i, col);
  const a = im.geometry.attributes.aInst.array;
  a[i * 4] = ph; a[i * 4 + 1] = amp; a[i * 4 + 2] = shrink; a[i * 4 + 3] = glow;
}

function seal(im, n) {
  im.count = n;
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.geometry.attributes.aInst.needsUpdate = true;
}

// Rotation that stands a prop up on the local slope, blended toward vertical.
function stand(n, blend, yaw) {
  _q2.setFromUnitVectors(UP, n);
  if (blend < 1) _q2.slerp(IDQ, 1 - blend);
  return _q2.multiply(_q.setFromAxisAngle(UP, yaw));
}

const CUR0 = 0.9;

// Per-zone material sets, built ONCE and reused across every reseed. Materials (and
// the texture/env-map refs they hold) are site-INVARIANT — only geometry/placement is
// re-rolled per site — so keeping them alive is what buys zero shader recompiles on
// reseed; three.js recompiles a program the first time a NEW material/defines combo
// hits the GPU, not on repeated use of an existing one.
let zoneMats = null;
function buildZoneMats() {
  return PAL.map(P => ({
    kelp: floraMat({ key: 'kelp', side: THREE.DoubleSide, rough: 0.72, sway: 1, freq: 0.7, cull: 130, sss: 0.38, glow: P.glow, def: ['SSS'] }),
    grass: floraMat({ key: 'grass', side: THREE.DoubleSide, rough: 0.8, sway: 1, freq: 1.15, cull: 85, sss: 0.4, glow: P.glow, def: ['SSS'] }),
    stag: floraMat({ key: 'stag', rough: 0.62, sway: 1, freq: 0.55, cull: 105, glow: P.glow, env: 0.14 }),
    fan: floraMat({ key: 'fan', side: THREE.DoubleSide, rough: 0.7, sway: 1, freq: 0.8, cull: 105, sss: 0.55, glow: P.glow, def: ['SSS', 'FAN'] }),
    brain: floraMat({ key: 'brain', rough: 0.66, sway: 0, cull: 105, glow: P.glow, env: 0.16, def: ['GROOVE'] }),
    sponge: floraMat({ key: 'sponge', side: THREE.DoubleSide, rough: 0.78, sway: 1, freq: 0.65, cull: 100, glow: P.glow, def: ['INNER'] }),
    anem: floraMat({ key: 'anem', side: THREE.DoubleSide, rough: 0.55, sway: 1, freq: 1.0, cull: 90, sss: 0.35, glow: P.glow, def: ['SSS'] }),
    rock: floraMat({ key: 'rock', flat: false, rough: 0.88, metal: 0.03, sway: 0, cull: 175, env: 0.12, silt: P.silt, def: ['SILT', 'ROCK'] })
  }));
}

// Tears down everything the previous build put in the scene/accumulators, WITHOUT
// touching zoneMats (site-invariant, see above) or the shared `uni` uniforms object.
function disposeFlora() {
  for (let zi = 0; zi < 3; zi++) {
    const grp = zones[zi];
    if (!grp) continue;
    for (const child of grp.children) {
      // Halo sprites (the bioluminescent-cluster glow) carry a UNIQUE SpriteMaterial
      // per build (their scale/opacity is placement-derived) — dispose it. Their
      // geometry is three.js's shared Sprite._geometry singleton; never dispose that.
      if (child.isSprite) child.material.dispose();
      // InstancedMesh geometry is `mount()`'s per-zone clone (see mount() below) —
      // always unique to this build, never shared, always safe/necessary to dispose.
      else if (child.geometry) child.geometry.dispose();
    }
    scene.remove(grp);
    zones[zi] = null;
  }
  // rockColliders' array IDENTITY is a contract with game.js/player.js/predators.js/
  // physics.js — they hold this reference forever, so truncate in place, never reassign.
  rockColliders.length = 0;
  // kelp{} is the other cross-build accumulator this file owns: data/meshes arrays
  // and the `inst` pointer all describe the build that disposeFlora() just tore down.
  kelp.data.length = 0;
  kelp.meshes.length = 0;
  kelp.inst = null;
}

function buildOnce() {
  // Fresh deterministic stream per build (THE CHART's contract): layout, orientation,
  // scale AND the procedural shapes below (kelp blades, rock erosion, ...) all read
  // through this one source, so the same site reseeds to the same forest, rock for
  // rock, bud for bud.
  const rng = siteParams('flora').rng;
  _fr = rng;
  if (!zoneMats) zoneMats = buildZoneMats();

  const G = {
    kelp: kelpGeo(), grass: grassGeo(), stag: staghornGeo(), fan: fanGeo(),
    brain: brainGeo(), sponge: spongeGeo(), anem: anemoneGeo(),
    // Tri counts are 20*(detail+1)^2: pebbles 320, boulders 980, heroes 3920 —
    // all per-geometry, shared across every instance of the tier.
    r0: rockGeo(3, 0.72, 0.70), r1: rockGeo(6, 0.95, 0.78), r2: rockGeo(13, 1.05, 0.64)
  };

  for (let zi = 0; zi < 3; zi++) {
    const P = PAL[zi];
    zones[zi] = new THREE.Group();
    scene.add(zones[zi]);
    const M = zoneMats[zi];

    const forest = seedClusters(zi, 26, 22, WORLD_R * 0.9, zi * 11.3 + 3, 0.40, 11, 24);
    const reef = seedClusters(zi, 24, 16, WORLD_R * 0.92, zi * 7.7 + 31, 0.42, 6, 15);
    const field = seedClusters(zi, 30, 12, WORLD_R * 0.99, zi * 5.1 + 61, 0.28, 15, 36);
    const turf = forest.concat(reef, field);

    // ---- giant kelp: canopy giants plus a bushy understory ----
    {
      const L = place(zi, zi === 0 ? 560 : 430, forest, 0.84);
      const im = mount(zi, G.kelp, M.kelp, L.length);
      for (let i = 0; i < L.length; i++) {
        const p = L[i], under = _fr() < 0.34;
        const H = under ? rr(2.6, 6.5) : rr(8, 21) * (0.8 + 0.4 * fbm(p.x * 0.03, p.z * 0.03));
        const W = under ? rr(1.9, 3.4) : rr(1.1, 2.3);
        const glow = _fr() < 0.12 ? rr(0.3, 0.85) : 0;
        _c.set(P.kelp[i % P.kelp.length]).multiplyScalar(rr(0.55, 1.15));
        put(im, i, stand(p.n, 0.35, rr(0, TAU)), W, H, p.x, p.y - 0.25, p.z,
          _c, _fr() * TAU, H * 0.1 / W, W * W / (2 * H * H) * 0.8, glow);
        kelp.data.push({ p: V3(p.x, p.y, p.z), h: H, zi });
      }
      seal(im, L.length);
      kelp.meshes.push(im);
      if (!kelp.inst) kelp.inst = im;
    }
    // ---- seagrass turf ----
    {
      const L = place(zi, [2600, 1500, 900][zi], turf, 0.72);
      const im = mount(zi, G.grass, M.grass, L.length);
      for (let i = 0; i < L.length; i++) {
        const p = L[i], H = rr(0.9, 2.8), W = rr(0.9, 1.8);
        _c.set((_fr() < 0.5 ? P.turfWarm : P.kelp)[(i + 1) % 4]).multiplyScalar(rr(0.45, 0.95));
        put(im, i, stand(p.n, 0.6, rr(0, TAU)), W, H, p.x, p.y - 0.1, p.z,
          _c, _fr() * TAU, H * 0.16 / W, 0.2, _fr() < 0.07 ? rr(0.2, 0.6) : 0);
      }
      seal(im, L.length);
    }
    // ---- reef: staghorn / fans / brain / sponges / anemones ----
    const reefCol = i => _c.set(P.reef[i % P.reef.length]).multiplyScalar(rr(0.55, 1.1));
    {
      const L = place(zi, 220, reef, 0.7);
      const im = mount(zi, G.stag, M.stag, L.length, true);
      for (let i = 0; i < L.length; i++) {
        const p = L[i], S = rr(1.1, 4.2);
        put(im, i, stand(p.n, 0.5, rr(0, TAU)), S, S * rr(0.8, 1.4), p.x, p.y - S * 0.12, p.z,
          reefCol(i), _fr() * TAU, 0.6 / S, 0.35, _fr() < 0.14 ? rr(0.3, 0.8) : 0);
      }
      seal(im, L.length);
    }
    {
      const L = place(zi, 150, reef, 0.5, 0.95);
      const im = mount(zi, G.fan, M.fan, L.length);
      const yaw = Math.atan2(Math.cos(CUR0), Math.sin(CUR0));
      for (let i = 0; i < L.length; i++) {
        const p = L[i], S = rr(1.4, 5);
        put(im, i, stand(p.n, 0.4, yaw + rr(-0.45, 0.45) + (_fr() < 0.5 ? Math.PI : 0)),
          S * rr(0.85, 1.25), S, p.x, p.y - S * 0.06, p.z,
          reefCol(i + 2), _fr() * TAU, 0.35 / S, 0.3, _fr() < 0.12 ? rr(0.25, 0.7) : 0);
      }
      seal(im, L.length);
    }
    {
      const L = place(zi, 110, reef, 0.72);
      const im = mount(zi, G.brain, M.brain, L.length, true);
      for (let i = 0; i < L.length; i++) {
        const p = L[i], S = rr(1.3, 4.6);
        put(im, i, stand(p.n, 0.75, rr(0, TAU)), S, S * rr(0.75, 1.1), p.x, p.y - S * 0.16, p.z,
          reefCol(i + 1), _fr() * TAU, 0, 0, _fr() < 0.3 ? rr(0.1, 0.45) : 0);
      }
      seal(im, L.length);
    }
    {
      const L = place(zi, 110, reef, 0.72);
      const im = mount(zi, G.sponge, M.sponge, L.length);
      for (let i = 0; i < L.length; i++) {
        const p = L[i], S = rr(1.2, 3.6);
        put(im, i, stand(p.n, 0.55, rr(0, TAU)), S, S * rr(1, 2), p.x, p.y - S * 0.08, p.z,
          reefCol(i + 3), _fr() * TAU, 0.3 / S, 0.3, _fr() < 0.18 ? rr(0.3, 0.9) : 0);
      }
      seal(im, L.length);
    }
    const lit = [];
    {
      const L = place(zi, 190, reef, 0.74);
      const im = mount(zi, G.anem, M.anem, L.length);
      for (let i = 0; i < L.length; i++) {
        const p = L[i], S = rr(0.7, 2.4);
        const glow = _fr() < 0.35 ? rr(0.4, 1.2) : 0;
        if (glow > 0.9 && lit.length < 6) lit.push([p, S]);
        put(im, i, stand(p.n, 0.7, rr(0, TAU)), S, S * rr(0.85, 1.2), p.x, p.y - S * 0.1, p.z,
          reefCol(i + 2), _fr() * TAU, 0.25 / S, 0.3, glow);
      }
      seal(im, L.length);
    }
    // Soft halos on the brightest polyp clusters — sells the bioluminescence at range.
    for (const [p, S] of lit) {
      const g = makeGlow(P.glow, S * 4.5);
      g.material.opacity = 0.16;
      g.position.set(p.x, p.y + S * 0.5, p.z);
      zones[zi].add(g);
    }
    // ---- rocks: pebbles, boulders, hero landmarks ----
    for (const [geo, cnt, sLo, sHi, sq] of [[G.r0, 300, 0.5, 2.2, 0.34], [G.r1, 110, 2, 7, 0.3]]) {
      const L = place(zi, cnt, field.concat(reef), 0.42);
      const im = mount(zi, geo, M.rock, L.length, true);
      for (let i = 0; i < L.length; i++) {
        const p = L[i], S = rr(sLo, sHi) * (0.7 + 0.9 * fbm(p.x * 0.05 + 9, p.z * 0.05));
        _c.set(P.rock).multiplyScalar(rr(0.7, 1.25));
        put(im, i, stand(p.n, 0.85, rr(0, TAU)), S * rr(0.85, 1.3), S * rr(0.7, 1.1),
          p.x, p.y - S * sq, p.z, _c, 0, 0, 0, 0);
        if (S >= 2) rockColliders.push({ x: p.x, y: p.y - S * sq + S * 0.45, z: p.z, r: S * 0.95 });
      }
      seal(im, L.length);
    }
    {
      const L = place(zi, 10, field, 0.62);
      const im = mount(zi, G.r2, M.rock, L.length + 60, true);
      let i = 0;
      for (const p of L) {
        const S = rr(8, 20);
        _c.set(P.rock).multiplyScalar(rr(0.75, 1.1));
        put(im, i++, stand(p.n, 0.6, rr(0, TAU)), S * rr(0.8, 1.25), S * rr(0.55, 0.95),
          p.x, p.y - S * 0.36, p.z, _c, 0, 0, 0, 0);
        rockColliders.push({ x: p.x, y: p.y - S * 0.36 + S * 0.4, z: p.z, r: S * 0.9 });
        // bed the landmark in with debris so it never reads as a floating prop
        for (let k = 0; k < 6 && i < L.length + 60; k++) {
          const a = rr(0, TAU), r = S * rr(0.7, 1.35), x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
          if (nearWreck(zi, x, z)) continue;
          const s2 = S * rr(0.08, 0.22);
          _c.set(P.rock).multiplyScalar(rr(0.6, 1.1));
          put(im, i++, stand(terrainNormal(x, z, zi), 0.85, rr(0, TAU)), s2 * 1.2, s2,
            x, terrainH(x, z, zi) - s2 * 0.4, z, _c, 0, 0, 0, 0);
        }
      }
      seal(im, i);
    }
  }
  for (const g of Object.values(G)) g.dispose();
}

// First boot: identical path to every prior version of this file (buildZoneMats()
// runs once here since zoneMats starts null; there is nothing yet to dispose).
export function buildFlora() {
  buildOnce();
}

// THE CHART's reseed hook: called when the player sails to another dive site, under
// the black screen, after terrain has already re-sampled. Tear down this build's
// geometry/instances/accumulators, keep the site-invariant materials, roll a fresh
// site-seeded stream, rebuild. Terrain reseeds itself (fillTerrain() in terrain.js);
// this is flora's half of the same contract.
export function reseedFlora() {
  disposeFlora();
  buildOnce();
}

export function updateFlora(dt, t) {
  uni.uTime.value = t;
  const a = CUR0 + 0.5 * Math.sin(t * 0.055);
  uni.uCur.value.set(Math.cos(a), Math.sin(a));
  // Only the zone(s) around the camera are submitted; the rest cost nothing.
  const y = camera.position.y;
  for (let zi = 0; zi < 3; zi++)
    if (zones[zi]) zones[zi].visible = y < zoneTop(zi) + 120 && y > zoneBottom(zi) - 150;
}
