// ABYSSA — gardens.js. OWNED BY: gardens agent (contract fixed by orchestrator).
//
// The second plant vocabulary: eleven generated benthic forms placed by zone, on top
// of flora.js's kelp / reef / rock world (which this file never touches).
//
//   ZONE 0 (sunlit reef)   sea fans, seagrass beds, staghorn thickets, barrel sponges,
//                          anemones
//   ZONE 1 (THE BOILER ROOM)  tube-worm colonies at the chimney feet (white tubes, red
//                          plumes that retract on a slow cycle), bacterial mats,
//                          stalked crinoids on the crust
//   ZONE 2 (lightless abyss)  sea pens (with faint additive tips — house fog law:
//                          additive fades to BLACK off scene.fog.density), glass
//                          sponges, whip corals
//
// TECHNIQUE (the abyssal reference, not its code): recursive TubeGeometry on
// Catmull-Rom paths with per-row taper for every branching form; lathe profiles with
// angular wobble for the barrels; rooted blade ribbons whose flex is zero at the
// rhizome and grows as height^1.4; every part tagged per-vertex (aVA / aFlut, the
// flora.js idiom) so all sway happens in ONE vertex shader off a shared uTime/uCur.
//
// CONTRACT
//   buildGardens()        once. Materials + geometry are created HERE and never again.
//                         Every InstancedMesh is allocated at its MAX capacity (sized
//                         for 20 vents / the densest authored site) so a reseed never
//                         grows a buffer. Must run AFTER buildFlora (reads its rock
//                         colliders as reef anchors) and AFTER buildVents (activeVents).
//   reseedGardens()       relayout in place from a fresh siteParams('gardens').rng —
//                         a stream of its own; flora's stream is never consumed, so
//                         flora/rock fingerprints are untouched by this module.
//                         Must run after reseedFlora AND reseedVents in reseedWorld.
//   updateGardens(dt, t)  ~4 uniform writes + 3 visibility compares. Zero allocation.
//
// Budget: 12 draw calls (11 lit instanced + 1 additive tip pass), ~150k tris on screen
// worst case, dithered range fade per type (no transparency, no sorting), fog ON on
// every lit material. Distinct customProgramCacheKey per material (the creatures.js
// shared-program hazard). Materials are site-invariant; only layout re-rolls.
import * as THREE from 'three';
import { scene, camera } from '../core.js';
import { WORLD_R, RIFT_R, riftPos, zoneTop, zoneBottom } from '../config.js';
import { clamp, fbm } from '../lib/math.js';
import { terrainH, terrainNormal } from './terrain.js';
import { wreckSites } from './wrecks.js';
import { siteParams, stream } from './site.js';
import { activeVents } from './vents.js';
import { rockColliders } from './flora.js';
import { windState } from './water.js';

const TAU = Math.PI * 2;

// Two streams, deliberately separate:
//   GEO_RNG — a FIXED seed for the shapes themselves (built once, ever), so boot and
//             arrive-back draw the same geometry and a reseed never regrows a buffer.
//   _gr     — the site's own 'gardens' stream, installed at the top of every layout().
//             Placement is a pure function of the site; nothing here reads Math.random.
let _gr = Math.random;
const rr = (a, b) => a + _gr() * (b - a);
let _ge = stream(0x6A4DE5);
const gr = (a, b) => a + _ge() * (b - a);

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), IDQ = new THREE.Quaternion();
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- shaders ----
// One family. Same vertex program body for every type (the defines only add), so the
// whole garden sways to a single uTime / uCur write per frame.
const uni = { uTime: { value: 0 }, uCur: { value: new THREE.Vector2(1, 0) }, uFogD: { value: 0.02 } };

const V_HEAD = `
attribute vec4 aVA;     // flex, normalised height, part mask, part phase
attribute float aFlut;  // local flutter weight
attribute vec4 aInst;   // phase, sway amp, arc-shorten k, per-instance weight
uniform float uTime; uniform vec2 uCur; uniform vec2 uCull;
uniform float uSway; uniform float uFreq; uniform float uFogD;
varying vec4 vGd; varying vec3 vGl;`;

const V_BODY = `
float gw = uTime * uFreq + aInst.x;
float gs1 = sin(gw - aVA.y * 3.1), gs2 = sin(gw * 1.71 - aVA.y * 5.7 + 1.3);
vec2 gd = (uCur * (0.34 + 0.66 * gs1) + vec2(-uCur.y, uCur.x) * (0.4 * gs2)) * (aInst.y * uSway * aVA.x);
transformed.xz += gd;
transformed.y -= dot(gd, gd) * aInst.z;
if (aFlut > 0.0) {
  float gf = gw * 2.2 + aVA.w;
  transformed += vec3(sin(gf) * 0.7, cos(gf * 1.31) * 0.5, sin(gf * 0.73 + 2.1) * 0.7) * aFlut;
}
#ifdef GD_WORM
  // Plume retraction: each tube (aVA.w) pulls its red crown down into the white tube
  // for a short stretch of a slow cycle, then it blooms back. aVA.z = plume weight.
  float grc = smoothstep(0.62, 0.92, sin(uTime * 0.17 + aVA.w));
  transformed.xz *= 1.0 - 0.85 * aVA.z * grc;
  transformed.y -= aVA.z * grc * 0.42;
#endif
vec3 giw = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
float gdd = distance(giw, cameraPosition);
float gfade = 1.0 - smoothstep(uCull.x, uCull.y, gdd);
// Fully faded instances collapse to a point: no fragments at all past the band.
transformed *= step(0.002, gfade);
vGd = vec4(aVA.z, aVA.y, gfade, aInst.w);
vGl = position;
#ifdef GD_TIP
  // House law for additive glow: fade to black by the LOCAL fog density, never toward
  // the fog colour (creatures.js / vents.js idiom).
  vGl.x = exp(-uFogD * uFogD * gdd * gdd);
#endif`;

const F_HEAD = `
uniform float uTime; uniform float uSSS; uniform vec3 uPale; uniform vec3 uPale2;
varying vec4 vGd; varying vec3 vGl;`;

// Dithered range fade: interleaved-gradient noise against the per-instance fade.
// Opaque, no sorting, no transparency; the far edge of every type dissolves into
// grain and then into the fog wall.
const F_DITHER = `
{
  float gdt = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (gdt > vGd.z) discard;
}`;

const F_BODY = `
#ifdef GD_LACE
  // Sea-fan lace: the membrane between branches is a mesh, not a sheet — a two-axis
  // sine grid punches the holes. Only lace vertices carry the mask.
  if (vGd.x > 0.5) {
    float gl1 = sin(vGl.x * 95.0) * sin(vGl.y * 95.0 + 1.3);
    if (gl1 > 0.22) discard;
    diffuseColor.rgb *= 0.72;
  }
#endif
#ifdef GD_PALE
  diffuseColor.rgb = mix(diffuseColor.rgb, uPale, vGd.x);
#endif
#ifdef GD_MAT
  // Bacterial crust: concentric rings (white centre, sulphur, rust rim) with a
  // mottled, cracked surface. Radius is the local distance from the disc centre.
  float gmr = clamp(length(vGl.xz) * 2.0, 0.0, 1.0);
  float gmn = sin(vGl.x * 31.0 + sin(vGl.z * 27.0 + 1.7) * 2.2) * sin(vGl.z * 29.0 + vGl.x * 7.0);
  float gcr = 1.0 - smoothstep(0.0, 0.18, abs(gmn - 0.55));
  vec3 gring = mix(uPale, uPale2, smoothstep(0.35, 0.85, gmr + gmn * 0.12));
  diffuseColor.rgb = mix(diffuseColor.rgb, gring, 0.85) * (1.0 - 0.45 * gcr) * (0.88 + 0.16 * gmn);
  roughnessFactor = mix(roughnessFactor, 1.0, gcr);
#endif
#ifdef GD_INNER
  if (!gl_FrontFacing) diffuseColor.rgb *= 0.35;
#endif
#ifdef GD_SSS
  float gfr = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.0);
  totalEmissiveRadiance += diffuseColor.rgb * uSSS * (0.18 + 0.82 * vGd.y) * (0.3 + 0.7 * gfr);
#endif`;

function gardenMat(o) {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0,
    side: o.side ?? THREE.FrontSide
  });
  m.defines = {};
  for (const d of o.def || []) m.defines['GD_' + d] = 1;
  const cull = o.cull ?? 90;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni, {
      uCull: { value: new THREE.Vector2(cull * 0.72, cull) },
      uSway: { value: o.sway ?? 0 }, uFreq: { value: o.freq ?? 0.85 },
      uSSS: { value: o.sss ?? 0 },
      uPale: { value: new THREE.Color(o.pale ?? 0xe8e2d2) },
      uPale2: { value: new THREE.Color(o.pale2 ?? 0x8a4a2a) }
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>' + V_HEAD)
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + V_BODY);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>' + F_HEAD)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>' + F_DITHER)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{' + F_BODY + '\n}');
  };
  m.customProgramCacheKey = () => 'gardens|' + o.key;
  return m;
}

// The one additive material: sea-pen tips. fog:false + manual extinction (vGl.x),
// unlit, dim, pulsing on the pen's own phase. Same vertex body so tips ride the sway.
function tipMat(o) {
  const m = new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false
  });
  m.forceSinglePass = true;
  m.defines = { GD_TIP: 1 };
  const cull = o.cull ?? 90;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni, {
      uCull: { value: new THREE.Vector2(cull * 0.72, cull) },
      uSway: { value: o.sway ?? 0 }, uFreq: { value: o.freq ?? 0.85 }
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>' + V_HEAD)
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + V_BODY);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>' + F_HEAD)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>' + F_DITHER)
      .replace('#include <opaque_fragment>', `
        float gpl = 0.55 + 0.45 * sin(uTime * 0.7 + vGd.w * 6.2831 + vGd.y * 4.0);
        outgoingLight *= vGl.x * gpl * ${(o.gain ?? 0.5).toFixed(3)};
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'gardens|tip';
  return m;
}

// ------------------------------------------------------------- geometry ------
// Accumulates transformed primitives into one indexed buffer, tagging every vertex
// with the per-part data the sway shader reads (flora.js's Build idiom).
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
    const o = { c: [1, 1, 1], flex: 0, mask: 0, flut: 0, ph: 0 };
    for (let k = 0; k < this.v; k++) {
      const x = this.p[k * 3], y = this.p[k * 3 + 1], z = this.p[k * 3 + 2], h = (y - lo) / span;
      o.c[0] = o.c[1] = o.c[2] = 1; o.flex = h * h; o.mask = 0; o.flut = 0; o.ph = this.meta[k].ph || 0;
      fn(x, y, z, h, this.meta[k], o);
      col[k * 3] = o.c[0]; col[k * 3 + 1] = o.c[1]; col[k * 3 + 2] = o.c[2];
      va[k * 4] = o.flex; va[k * 4 + 1] = h; va[k * 4 + 2] = o.mask; va[k * 4 + 3] = o.ph;
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

const ID = new THREE.Matrix4();
function xf(px, py, pz, ry = 0, rz = 0, rx = 0, sx = 1, sy = sx, sz = sx) {
  const m = new THREE.Matrix4().makeRotationY(ry);
  if (rz) m.multiply(new THREE.Matrix4().makeRotationZ(rz));
  if (rx) m.multiply(new THREE.Matrix4().makeRotationX(rx));
  m.scale(_s.set(sx, sy, sz));
  m.setPosition(px, py, pz);
  return m;
}

// Tapered tube on a Catmull-Rom path: every ring is scaled about its own centre by
// (r0 -> r1), which is what makes a branch read as grown rather than extruded.
function tubeGeo(pts, segs, r0, r1, sides) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, segs, r0, sides, false);
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const row = Math.floor(k / (sides + 1)), t = row / segs;
    curve.getPointAt(t, _v);
    const tp = 1 + (r1 / r0 - 1) * t;
    p.setXYZ(k, _v.x + (p.getX(k) - _v.x) * tp, _v.y + (p.getY(k) - _v.y) * tp, _v.z + (p.getZ(k) - _v.z) * tp);
  }
  g.computeVertexNormals();
  return g;
}

// Rooted blade: zero flex at the rhizome, leaning with t^2, width tapering to a tip.
function bladeGeo(h, w, lean, rows = 5) {
  const p = [], idx = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, bend = lean * t * t, side = w * (1 - 0.85 * t * t), y = h * (t - 0.19 * t * t * t);
    p.push(-side, y, bend, side, y, bend);
    if (j < rows) { const n = j * 2; idx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Flat triangle (lace membrane between two fan branches).
function triGeo(a, b, c) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], 3));
  g.setIndex([0, 1, 2]);
  g.computeVertexNormals();
  return g;
}

// ---- ZONE 0 ------------------------------------------------------------------
// Sea fan: a gorgonian grown in the XY plane by recursive tapered tubes, with lace
// stretched between each pair of sister branches (mesh-punched in the fragment).
function seaFanGeo() {
  const B = new Build();
  const grow = (s, ang, len, w, d) => {
    const e = new THREE.Vector3(s.x - Math.sin(ang) * len, s.y + Math.cos(ang) * len, 0);
    const mid = s.clone().lerp(e, 0.5); mid.x += gr(-0.06, 0.06) * len; mid.z += gr(-0.02, 0.02) * len;
    const g = tubeGeo([s, mid, e], 2, w, w * 0.7, 3);
    B.add(g, ID, { t: 'b', d });
    g.dispose();
    if (d >= 4) return;
    const n = d === 0 ? 3 : 2, tips = [];
    for (let i = 0; i < n; i++) {
      const a2 = ang + (i - (n - 1) / 2) * gr(0.36, 0.64) + gr(-0.08, 0.08);
      const l2 = len * gr(0.66, 0.82);
      tips.push(new THREE.Vector3(e.x - Math.sin(a2) * l2 * 0.72, e.y + Math.cos(a2) * l2 * 0.72, 0));
      grow(e, a2, l2, w * 0.74, d + 1);
    }
    for (let i = 0; i + 1 < tips.length; i++) {
      const g2 = triGeo(e, tips[i], tips[i + 1]);
      B.add(g2, ID, { t: 'l', d });
      g2.dispose();
    }
  };
  grow(new THREE.Vector3(0, 0, 0), 0, 0.34, 0.03, 0);
  return B.done((x, y, z, h, m, o) => {
    const s = 0.34 + 0.66 * h;
    o.c[0] = s; o.c[1] = s * 0.9; o.c[2] = s * 0.92;
    o.flex = h * h; o.mask = m.t === 'l' ? 1 : 0;
    if (m.t === 'l') { o.c[0] *= 0.8; o.c[1] *= 0.8; o.c[2] *= 0.8; }
  });
}

// Seagrass clump: ten rooted blades leaning off one rhizome.
function seagrassGeo() {
  const B = new Build();
  const lean = gr(0, TAU);
  for (let i = 0; i < 10; i++) {
    const a = gr(0, TAU), r = Math.sqrt(_ge()) * 0.14, h = gr(0.45, 1);
    const g = bladeGeo(h, gr(0.016, 0.03), h * gr(0.2, 0.7));
    B.add(g, xf(Math.cos(a) * r, 0, Math.sin(a) * r, lean + gr(-0.8, 0.8)), { ph: gr(0, TAU), h });
    g.dispose();
  }
  return B.done((x, y, z, h, m, o) => {
    const u = clamp(y / m.h, 0, 1), s = 0.32 + 0.68 * u;
    o.c[0] = s * 0.72; o.c[1] = s; o.c[2] = s * 0.66;
    o.flex = Math.pow(u, 1.4); o.flut = 0.02 * u * u;
  });
}

// Staghorn thicket: three trunks of recursive tapered tubes; tips finished paler.
function staghornGeo() {
  const B = new Build();
  const rec = (s, dir, len, rad, lv) => {
    const e = s.clone().addScaledVector(dir, len);
    const mid = s.clone().lerp(e, 0.52).add(new THREE.Vector3(gr(-0.5, 0.5) * len * 0.12, 0, gr(-0.5, 0.5) * len * 0.12));
    const g = tubeGeo([s, mid, e], 2, rad, rad * 0.62, lv >= 2 ? 4 : 3);
    B.add(g, ID, { t: 'b' });
    g.dispose();
    if (lv <= 0) {
      const tip = e.clone().addScaledVector(dir, len * 0.22);
      const g2 = tubeGeo([e, tip], 1, rad * 0.6, rad * 0.18, 3);
      B.add(g2, ID, { t: 't' });
      g2.dispose();
      return;
    }
    const forks = lv > 1 ? 3 : 2;
    for (let j = 0; j < forks; j++) {
      const nd = new THREE.Vector3(gr(-0.75, 0.75), 0.5 + gr(0, 0.7), gr(-0.75, 0.75)).addScaledVector(dir, 0.5).normalize();
      rec(e, nd, len * gr(0.63, 0.73), rad * 0.69, lv - 1);
    }
  };
  const ang = gr(0, TAU);
  for (let j = 0; j < 3; j++) {
    const a = ang + j / 3 * TAU;
    rec(new THREE.Vector3(Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03),
      new THREE.Vector3(Math.cos(a) * 0.55, 0.7 + gr(0, 0.35), Math.sin(a) * 0.55).normalize(), 0.3, 0.045, 2);
  }
  return B.done((x, y, z, h, m, o) => {
    const s = 0.36 + 0.64 * h;
    o.c[0] = s; o.c[1] = s * 0.9; o.c[2] = s * 0.86;
    o.flex = h * h * 0.5; o.mask = m.t === 't' ? 1 : sstep(0.75, 1, h) * 0.5;
  });
}

// Barrel sponge: a lathe whose profile climbs the outside and returns down the
// inside (hollow), ribbed by angular wobble.
function barrelGeo() {
  const prof = [[0.30, 0], [0.46, 0.22], [0.58, 0.62], [0.64, 1.1], [0.62, 1.5], [0.56, 1.68], [0.44, 1.72], [0.38, 1.5], [0.36, 1.0], [0.30, 0.5], [0.16, 0.3]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 14);
  const p = g.attributes.position, wob = gr(0, 9);
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k), a = Math.atan2(z, x);
    const f = 1 + Math.sin(a * 9 + y * 2.5 + wob) * 0.07 + Math.cos(a * 4 - y * 1.7) * 0.05 + Math.sin(y * 6.1 + wob) * 0.03;
    p.setXYZ(k, x * f, y, z * f);
  }
  g.computeVertexNormals();
  const B = new Build();
  B.add(g, ID);
  g.dispose();
  return B.done((x, y, z, h, m, o) => {
    const rad = Math.hypot(x, z), inner = y > 0.28 && rad < 0.42 ? 1 : 0;
    const s = (0.42 + 0.58 * h) * (1 - 0.5 * inner);
    o.c[0] = s; o.c[1] = s * 0.78; o.c[2] = s * 0.72;
    o.flex = h * h * 0.25;
  });
}

// Anemone: an open stalk, an oral disc, and 20 tapered tentacles in two rings
// curving outward — the crown waves, the stalk holds.
function anemoneGeo() {
  const B = new Build();
  const col = new THREE.CylinderGeometry(0.16, 0.12, 0.28, 8, 1, true);
  col.translate(0, 0.14, 0);
  B.add(col, ID, { t: 'c' });
  const disc = new THREE.SphereGeometry(0.17, 8, 3, 0, TAU, 0, Math.PI * 0.5);
  B.add(disc, xf(0, 0.25, 0, 0, 0, 0, 0.85, 0.3, 0.85), { t: 'c' });
  for (let i = 0; i < 20; i++) {
    const ring = i < 13 ? 0 : 1, a = (i - (ring ? 13 : 0)) / (ring ? 7 : 13) * TAU + ring * 0.3;
    const r = ring ? 0.07 : 0.145, len = gr(0.28, 0.46), up = ring ? gr(0.75, 1.0) : gr(0.35, 0.65);
    const b = new THREE.Vector3(Math.sin(a) * r, 0.29, Math.cos(a) * r);
    const d = new THREE.Vector3(Math.sin(a) * (1 - up), up, Math.cos(a) * (1 - up)).normalize();
    const mid = b.clone().addScaledVector(d, len * 0.5); mid.y += len * 0.18;
    const e = b.clone().addScaledVector(d, len); e.y -= len * gr(0.0, 0.2);
    const g = tubeGeo([b, mid, e], 2, 0.026, 0.008, 3);
    B.add(g, ID, { t: 't', ph: gr(0, TAU), bx: b.x, by: b.y, bz: b.z, len });
    g.dispose();
  }
  col.dispose(); disc.dispose();
  return B.done((x, y, z, h, m, o) => {
    if (m.t === 't') {
      const u = clamp(Math.hypot(x - m.bx, y - m.by, z - m.bz) / m.len, 0, 1), s = 0.5 + 0.5 * u;
      o.c[0] = s; o.c[1] = s * 0.94; o.c[2] = s * 0.9;
      o.flex = u * u; o.flut = 0.04 * u * u; o.mask = sstep(0.6, 1, u);
    } else {
      const s = 0.32 + 0.3 * h;
      o.c[0] = s * 0.9; o.c[1] = s * 0.78; o.c[2] = s * 0.8;
      o.flex = 0;
    }
  });
}

// ---- ZONE 1 ------------------------------------------------------------------
// Tube-worm colony: 16 white chitin tubes leaning off one clump, each crowned by
// a red branchial plume. The plume vertices carry mask=1 (retract weight) and the
// tube's own phase so the crowns retract one at a time.
function tubewormGeo() {
  const B = new Build();
  for (let i = 0; i < 16; i++) {
    const a = gr(0, TAU), r = Math.sqrt(_ge()) * 0.42, ph = gr(0, TAU);
    const b = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    const lean = new THREE.Vector3(gr(-0.3, 0.3), 1, gr(-0.3, 0.3)).normalize();
    const H = gr(0.45, 1.05);
    const top = b.clone().addScaledVector(lean, H);
    const mid = b.clone().addScaledVector(lean, H * 0.5); mid.x += gr(-0.04, 0.04); mid.z += gr(-0.04, 0.04);
    const tube = tubeGeo([b, mid, top], 2, 0.03, 0.026, 5);
    B.add(tube, ID, { t: 'w', ph, H });
    tube.dispose();
    const pt = top.clone().addScaledVector(lean, 0.13);
    const plume = tubeGeo([top, pt], 2, 0.019, 0.05, 5);
    B.add(plume, ID, { t: 'p', ph, H });
    plume.dispose();
    const cap = new THREE.ConeGeometry(0.05, 0.05, 5, 1, true);
    cap.translate(0, 0.025, 0);
    B.add(cap, xf(pt.x, pt.y, pt.z, 0, 0, 0, 1, 1, 1), { t: 'p', ph, H });
    cap.dispose();
  }
  return B.done((x, y, z, h, m, o) => {
    if (m.t === 'p') {
      o.c[0] = 0.72; o.c[1] = 0.1; o.c[2] = 0.08;
      o.flex = h * h * 0.4; o.mask = 1; o.flut = 0.006;
    } else {
      const s = 0.55 + 0.45 * clamp(y / m.H, 0, 1);
      o.c[0] = s; o.c[1] = s * 0.98; o.c[2] = s * 0.92;
      o.flex = h * h * 0.15; o.mask = 0;
    }
  });
}

// Bacterial mat: a shallow dome disc with a wobbling rim; crust detail is per-pixel.
function matGeo() {
  const p = [0, 0.03, 0], idx = [], N = 14, w = gr(0, 9);
  for (let ring = 1; ring <= 2; ring++) {
    for (let i = 0; i < N; i++) {
      const a = i / N * TAU, rw = ring === 2 ? 1 + 0.12 * Math.sin(a * 5 + w) + 0.06 * Math.sin(a * 9 - w) : 0.5;
      p.push(Math.cos(a) * 0.5 * rw, ring === 1 ? 0.02 : 0.004, Math.sin(a) * 0.5 * rw);
    }
  }
  for (let i = 0; i < N; i++) {
    const a = 1 + i, b = 1 + (i + 1) % N;
    idx.push(0, b, a);
    const c = 1 + N + i, d = 1 + N + (i + 1) % N;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const B = new Build();
  B.add(g, ID);
  g.dispose();
  return B.done((x, y, z, h, m, o) => { o.c[0] = 0.9; o.c[1] = 0.86; o.c[2] = 0.7; o.flex = 0; });
}

// Stalked crinoid: a curved stalk, a small calyx, ten feathered arms opening upward.
function crinoidGeo() {
  const B = new Build();
  const H = gr(0.6, 1.0), sw = gr(-0.12, 0.12);
  const stalk = tubeGeo([new THREE.Vector3(0, 0, 0), new THREE.Vector3(sw, H * 0.5, sw * 0.5), new THREE.Vector3(sw * 1.4, H, 0)], 3, 0.02, 0.014, 4);
  B.add(stalk, ID, { t: 's' });
  stalk.dispose();
  const calyx = new THREE.IcosahedronGeometry(0.045, 0);
  const top = new THREE.Vector3(sw * 1.4, H, 0);
  B.add(calyx, xf(top.x, top.y, top.z), { t: 's' });
  calyx.dispose();
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * TAU + gr(-0.15, 0.15), len = gr(0.28, 0.4), ph = gr(0, TAU);
    const d = new THREE.Vector3(Math.cos(a) * 0.55, 0.8, Math.sin(a) * 0.55).normalize();
    const mid = top.clone().addScaledVector(d, len * 0.5); mid.y += len * 0.08;
    const e = top.clone().addScaledVector(d, len); e.y += len * 0.05;
    const g = tubeGeo([top, mid, e], 3, 0.011, 0.004, 3);
    B.add(g, ID, { t: 'a', ph, len });
    g.dispose();
    // pinnules: a thin ribbon either side of the arm, the feather read
    const f = bladeGeo(len * 0.9, 0.035, 0, 2);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, d);
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
    m.setPosition(top.x, top.y, top.z);
    B.add(f, m, { t: 'f', ph, len });
    f.dispose();
  }
  return B.done((x, y, z, h, m, o) => {
    if (m.t === 's') {
      const s = 0.4 + 0.3 * h;
      o.c[0] = s * 0.9; o.c[1] = s * 0.86; o.c[2] = s * 0.78;
      o.flex = h * h * 0.2;
    } else {
      const u = clamp(Math.hypot(x - top.x, y - top.y, z - top.z) / m.len, 0, 1), s = 0.5 + 0.5 * u;
      o.c[0] = s * 0.95; o.c[1] = s * 0.8; o.c[2] = s * 0.55;
      if (m.t === 'f') { o.c[0] *= 0.85; o.c[1] *= 0.85; o.c[2] *= 0.85; }
      o.flex = 0.2 + Math.pow(u, 1.4) * 0.8; o.flut = 0.025 * u;
    }
  });
}

// ---- ZONE 2 ------------------------------------------------------------------
// Sea pen: a quill (tapered tube) with two rows of pinnae; the pinna tips are also
// emitted separately (penTipGeo) for the additive pass.
const PEN_N = 11;
function penSpec() {
  const spec = [], H = 1;
  for (let i = 0; i < PEN_N; i++) {
    const t = 0.3 + 0.62 * (i / (PEN_N - 1));
    const len = 0.22 * Math.sin(Math.PI * (0.2 + 0.8 * (i / (PEN_N - 1)))) + 0.06;
    spec.push({ y: t * H, len, ph: gr(0, TAU) });
  }
  return spec;
}
let PEN_SPEC = null;
function seaPenGeo() {
  const B = new Build();
  const quill = tubeGeo([new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(0.02, 0.5, 0), new THREE.Vector3(0.04, 1.05, 0)], 4, 0.022, 0.006, 4);
  B.add(quill, ID, { t: 'q' });
  quill.dispose();
  for (const s of PEN_SPEC) for (const sd of [-1, 1]) {
    const f = bladeGeo(s.len, 0.028, s.len * 0.25, 2);
    // pinna: rooted on the rachis, growing sideways (+/-X) and a little up
    B.add(f, xf(0.02 * s.y, s.y, 0, 0, sd * 1.25, 0), { t: 'p', ph: s.ph, len: s.len, by: s.y });
    f.dispose();
  }
  return B.done((x, y, z, h, m, o) => {
    if (m.t === 'q') {
      const s = 0.45 + 0.4 * h;
      o.c[0] = s * 0.9; o.c[1] = s * 0.7; o.c[2] = s * 0.62;
      o.flex = Math.pow(h, 1.4) * 0.8;
    } else {
      const u = clamp(Math.hypot(x, y - m.by) / m.len, 0, 1), s = 0.5 + 0.5 * u;
      o.c[0] = s * 0.92; o.c[1] = s * 0.72; o.c[2] = s * 0.66;
      o.flex = Math.pow(h, 1.4) * 0.8 + u * 0.15; o.flut = 0.012 * u; o.mask = u;
    }
  });
}
function penTipGeo() {
  const B = new Build();
  const q = new THREE.PlaneGeometry(0.05, 0.05);
  for (const s of PEN_SPEC) for (const sd of [-1, 1]) {
    const tx = sd * (s.len * 0.94) * Math.cos(0.32), ty = s.y + s.len * 0.94 * Math.sin(0.32) + 0.02 * s.y;
    B.add(q, xf(tx, ty, 0, 0, 0, 0, 1, 1, 1), { ph: s.ph, by: s.y, len: s.len });
  }
  q.dispose();
  return B.done((x, y, z, h, m, o) => {
    o.c[0] = 0.55; o.c[1] = 0.85; o.c[2] = 1.0;
    o.flex = Math.pow(h, 1.4) * 0.8 + 0.15; o.flut = 0.012; o.mask = 1;
  });
}

// Glass sponge: a lattice basket — vertical ribs on a vase profile, horizontal hoops.
function glassGeo() {
  const B = new Build();
  const prof = t => 0.18 + 0.3 * Math.sin(t * Math.PI * 0.85 + 0.25) - 0.1 * t;
  const RIBS = 7, HOOPS = 5;
  for (let i = 0; i < RIBS; i++) {
    const a = i / RIBS * TAU + gr(-0.1, 0.1), pts = [];
    for (let j = 0; j <= 4; j++) { const t = j / 4, r = prof(t); pts.push(new THREE.Vector3(Math.cos(a) * r, t, Math.sin(a) * r)); }
    const g = tubeGeo(pts, 5, 0.014, 0.01, 3);
    B.add(g, ID, {});
    g.dispose();
  }
  for (let j = 0; j < HOOPS; j++) {
    const t = 0.1 + 0.85 * (j / (HOOPS - 1)), r = prof(t);
    const g = new THREE.TorusGeometry(r, 0.01, 3, 12);
    B.add(g, xf(0, t, 0, 0, 0, Math.PI / 2), {});
    g.dispose();
  }
  return B.done((x, y, z, h, m, o) => {
    const s = 0.55 + 0.45 * h;
    o.c[0] = s * 0.86; o.c[1] = s * 0.94; o.c[2] = s;
    o.flex = h * h * 0.05;
  });
}

// Whip coral: one long tapered tube on a gentle S, bending in the deep current.
function whipGeo() {
  const H = gr(0.85, 1.15), a = gr(0, TAU);
  const pts = [new THREE.Vector3(0, 0, 0)];
  for (let j = 1; j <= 3; j++) {
    const t = j / 3, sw = Math.sin(t * 3.2 + a) * 0.06 * t;
    pts.push(new THREE.Vector3(Math.cos(a) * sw, H * t, Math.sin(a) * sw));
  }
  const g = tubeGeo(pts, 8, 0.016, 0.005, 4);
  const B = new Build();
  B.add(g, ID);
  g.dispose();
  return B.done((x, y, z, h, m, o) => {
    const s = 0.5 + 0.5 * h;
    o.c[0] = s * 0.95; o.c[1] = s * 0.86; o.c[2] = s * 0.7;
    o.flex = Math.pow(h, 1.4);
  });
}

// -------------------------------------------------------------- placement ----
const WRECK_MARGIN = 4;
function nearWreck(zi, x, z) {
  const w = wreckSites()[zi];
  const d = w.clear + WRECK_MARGIN;
  return (x - w.x) * (x - w.x) + (z - w.z) * (z - w.z) < d * d;
}

function inZoneBand(y, zi) { return y < zoneTop(zi) + 10 && y > zoneBottom(zi) - 60; }

// Reef anchors: flora's boulders in this zone (colliders carry world y) — the gardens
// grow where the reef already is. Plus a few fbm-gated clusters of its own so open
// sand gets the occasional stand.
function reefSeeds(zi, own, radLo, radHi, thresh, seed) {
  const out = [];
  for (const c of rockColliders) if (inZoneBand(c.y, zi)) out.push([c.x, c.z, c.r * rr(1.6, 2.6)]);
  const rp = riftPos(zi), want = out.length + own;
  let guard = 0;
  while (out.length < want && guard++ < own * 60) {
    const a = _gr() * TAU, r = rr(16, WORLD_R * 0.92);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_R * 3) continue;
    if (fbm(x * 0.011 + seed, z * 0.011 - seed) < thresh) continue;
    out.push([x, z, rr(radLo, radHi)]);
  }
  return out;
}

function fieldSeeds(zi, n, radLo, radHi, thresh, seed) {
  const out = [], rp = riftPos(zi);
  let guard = 0;
  while (out.length < n && guard++ < n * 70) {
    const a = _gr() * TAU, r = rr(14, WORLD_R * 0.97);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_R * 3) continue;
    if (guard < n * 35 && fbm(x * 0.011 + seed, z * 0.011 - seed) < thresh) continue;
    out.push([x, z, rr(radLo, radHi)]);
  }
  return out;
}

// Clumped sampling with slope gating (flora.js's place()), against this module's own
// stream. Same exclusions: rift funnel, wreck site, the raft's water, the rim.
const _pts = [];
function place(zi, count, seeds, minSlope, maxSlope = 1.01) {
  _pts.length = 0;
  if (!seeds.length) return _pts;
  const rp = riftPos(zi);
  let lo = minSlope, guard = 0, relaxed = false;
  while (_pts.length < count && guard++ < count * 40) {
    if (!relaxed && guard > count * 18) { relaxed = true; lo = 1 - (1 - lo) * 2.4; }
    const s = seeds[(_gr() * seeds.length) | 0];
    const a = _gr() * TAU, u = Math.pow(_gr(), 0.8);
    if (_gr() < u * 0.5) continue;
    const x = s[0] + Math.cos(a) * s[2] * u, z = s[1] + Math.sin(a) * s[2] * u;
    const r = Math.hypot(x, z);
    if (r > WORLD_R * 0.98 || r < 10) continue;
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_R * 2.4) continue;
    if (nearWreck(zi, x, z)) continue;
    const n = terrainNormal(x, z, zi);
    if (n.y < lo || n.y > maxSlope) continue;
    _pts.push({ x, z, y: terrainH(x, z, zi), n });
  }
  return _pts;
}

// ------------------------------------------------------------------ build ----
// Capacities: fixed at build, never grown. Vent-anchored types are sized for 20 vents.
const CAP = {
  fan: 60, grass: 320, stag: 80, barrel: 70, anem: 64,
  worm: 100, mat: 140, crin: 120,
  pen: 180, glass: 50, whip: 180
};
// Range fade per type (the far edge of the band is where the dither has finished).
const CULL = {
  fan: 95, grass: 62, stag: 95, barrel: 105, anem: 80,
  worm: 80, mat: 70, crin: 85,
  pen: 90, glass: 110, whip: 100
};

const PAL = {
  fan: [0xb8666e, 0xc48a5a, 0x8f6a9e, 0xc4a25a],
  stag: [0xd7a46a, 0xc8846e, 0xa9b96e, 0xd8c08a],
  barrel: [0xb85a3e, 0xa14a52, 0xc0763a],
  anem: [0xc8907e, 0x8fb09a, 0xcaa870, 0xa88ab8],
  grass: [0x5f8a4a, 0x6f9a3e, 0x4e7f52],
  worm: [0xe8e2d2, 0xd9d1bc],
  mat: [0xf0e6c8, 0xd8c88a, 0xe8d8a0],
  crin: [0xc9a15a, 0xa87a4e, 0xd6b96e],
  pen: [0xc98a72, 0xb87862, 0xd8a08a],
  glass: [0xd6e4ee, 0xc4d6e4],
  whip: [0xc9b58a, 0xb59a6a, 0xd8c8a0]
};

let built = false;
const zones = [null, null, null];
const IM = {};           // name -> InstancedMesh
let penTips = null;
let mats = null;

function makeMats() {
  return {
    fan: gardenMat({ key: 'fan', side: THREE.DoubleSide, rough: 0.72, sway: 1, freq: 0.8, cull: CULL.fan, sss: 0.4, def: ['SSS', 'LACE'] }),
    grass: gardenMat({ key: 'grass', side: THREE.DoubleSide, rough: 0.8, sway: 1, freq: 1.2, cull: CULL.grass, sss: 0.45, def: ['SSS'] }),
    stag: gardenMat({ key: 'stag', rough: 0.62, sway: 1, freq: 0.5, cull: CULL.stag, pale: 0xf2ece0, def: ['PALE'] }),
    barrel: gardenMat({ key: 'barrel', side: THREE.DoubleSide, rough: 0.82, sway: 1, freq: 0.5, cull: CULL.barrel, def: ['INNER'] }),
    anem: gardenMat({ key: 'anem', side: THREE.DoubleSide, rough: 0.55, sway: 1, freq: 1.0, cull: CULL.anem, sss: 0.35, pale: 0xfff0e0, def: ['SSS', 'PALE'] }),
    worm: gardenMat({ key: 'worm', side: THREE.DoubleSide, rough: 0.7, sway: 1, freq: 0.6, cull: CULL.worm, def: ['WORM', 'INNER'] }),
    mat: gardenMat({ key: 'mat', rough: 0.95, sway: 0, cull: CULL.mat, pale: 0xf3ecd8, pale2: 0x9a4e28, def: ['MAT'] }),
    crin: gardenMat({ key: 'crin', side: THREE.DoubleSide, rough: 0.7, sway: 1, freq: 0.7, cull: CULL.crin, sss: 0.3, def: ['SSS'] }),
    pen: gardenMat({ key: 'pen', side: THREE.DoubleSide, rough: 0.75, sway: 1, freq: 0.55, cull: CULL.pen, sss: 0.3, def: ['SSS'] }),
    glass: gardenMat({ key: 'glass', side: THREE.DoubleSide, rough: 0.35, metal: 0.05, sway: 1, freq: 0.4, cull: CULL.glass, sss: 0.6, def: ['SSS'] }),
    whip: gardenMat({ key: 'whip', rough: 0.7, sway: 1, freq: 0.45, cull: CULL.whip }),
    tip: tipMat({ sway: 1, freq: 0.55, cull: CULL.pen, gain: 0.42 })
  };
}

function mount(zi, name, geo, mat, cap) {
  const g = geo;
  g.setAttribute('aInst', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
  const im = new THREE.InstancedMesh(g, mat, cap);
  // Preallocate the colour buffer too: setColorAt would otherwise allocate on first use.
  im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  im.castShadow = false; im.receiveShadow = false;
  im.frustumCulled = false;   // the field spans the zone; the depth band + range fade cull
  im.count = 0;
  zones[zi].add(im);
  IM[name] = im;
  return im;
}

function put(im, i, q, sx, sy, x, y, z, col, ph, amp, shrink, w) {
  _m.compose(_p.set(x, y, z), q, _s.set(sx, sy, sx));
  im.setMatrixAt(i, _m);
  im.setColorAt(i, col);
  const a = im.geometry.attributes.aInst.array;
  a[i * 4] = ph; a[i * 4 + 1] = amp; a[i * 4 + 2] = shrink; a[i * 4 + 3] = w;
}

function seal(im, n) {
  im.count = n;
  im.instanceMatrix.needsUpdate = true;
  im.instanceColor.needsUpdate = true;
  im.geometry.attributes.aInst.needsUpdate = true;
}

function stand(n, blend, yaw) {
  _q2.setFromUnitVectors(UP, n);
  if (blend < 1) _q2.slerp(IDQ, 1 - blend);
  return _q2.multiply(_q.setFromAxisAngle(UP, yaw));
}

const CUR0 = 0.9;
const pick = (list, i, lo, hi) => _c.set(list[i % list.length]).multiplyScalar(rr(lo, hi));

export function buildGardens() {
  if (built) return;
  built = true;
  _ge = stream(0x6A4DE5);
  mats = makeMats();
  for (let zi = 0; zi < 3; zi++) { zones[zi] = new THREE.Group(); zones[zi].name = 'gardens' + zi; scene.add(zones[zi]); }
  PEN_SPEC = penSpec();

  mount(0, 'fan', seaFanGeo(), mats.fan, CAP.fan);
  mount(0, 'grass', seagrassGeo(), mats.grass, CAP.grass);
  mount(0, 'stag', staghornGeo(), mats.stag, CAP.stag);
  mount(0, 'barrel', barrelGeo(), mats.barrel, CAP.barrel);
  mount(0, 'anem', anemoneGeo(), mats.anem, CAP.anem);
  mount(1, 'worm', tubewormGeo(), mats.worm, CAP.worm);
  mount(1, 'mat', matGeo(), mats.mat, CAP.mat);
  mount(1, 'crin', crinoidGeo(), mats.crin, CAP.crin);
  mount(2, 'pen', seaPenGeo(), mats.pen, CAP.pen);
  mount(2, 'glass', glassGeo(), mats.glass, CAP.glass);
  mount(2, 'whip', whipGeo(), mats.whip, CAP.whip);
  penTips = mount(2, 'tip', penTipGeo(), mats.tip, CAP.pen);
  penTips.renderOrder = 2;

  layout();
}

export function reseedGardens() {
  if (!built) { buildGardens(); return; }
  layout();
}

// Layout: pure function of siteParams('gardens').rng + the current activeVents and
// flora colliders (themselves pure functions of the site). Writes in place.
function layout() {
  _gr = siteParams('gardens').rng;

  // ---- ZONE 0: the reef gardens -------------------------------------------
  {
    const zi = 0;
    const reef = reefSeeds(zi, 14, 5, 12, 0.42, 17.3);
    const field = fieldSeeds(zi, 22, 12, 30, 0.30, 44.1);
    const yaw = Math.atan2(Math.cos(CUR0), Math.sin(CUR0));
    let L = place(zi, CAP.fan, reef, 0.5, 0.97);
    let im = IM.fan;
    for (let i = 0; i < L.length; i++) {
      const p = L[i], S = rr(1.2, 3.2);
      put(im, i, stand(p.n, 0.4, yaw + rr(-0.5, 0.5) + (_gr() < 0.5 ? Math.PI : 0)), S * rr(0.85, 1.2), S,
        p.x, p.y - S * 0.04, p.z, pick(PAL.fan, i, 0.6, 1.1), _gr() * TAU, 0.3 / S, 0.3, _gr());
    }
    seal(im, L.length);

    L = place(zi, CAP.grass, field.concat(reef), 0.8);
    im = IM.grass;
    for (let i = 0; i < L.length; i++) {
      const p = L[i], S = rr(1.6, 3.2), H = rr(1.2, 2.4);
      put(im, i, stand(p.n, 0.6, rr(0, TAU)), S, H, p.x, p.y - 0.04, p.z,
        pick(PAL.grass, i, 0.5, 1.0), _gr() * TAU, 0.22 / S, 0.25, _gr());
    }
    seal(im, L.length);

    L = place(zi, CAP.stag, reef, 0.7);
    im = IM.stag;
    for (let i = 0; i < L.length; i++) {
      const p = L[i], S = rr(1.4, 3.6);
      put(im, i, stand(p.n, 0.5, rr(0, TAU)), S, S * rr(0.8, 1.3), p.x, p.y - S * 0.03, p.z,
        pick(PAL.stag, i, 0.6, 1.05), _gr() * TAU, 0.45 / S, 0.35, _gr());
    }
    seal(im, L.length);

    L = place(zi, CAP.barrel, reef, 0.72);
    im = IM.barrel;
    for (let i = 0; i < L.length; i++) {
      const p = L[i], S = rr(0.7, 1.9);
      put(im, i, stand(p.n, 0.7, rr(0, TAU)), S, S * rr(0.9, 1.5), p.x, p.y - S * 0.05, p.z,
        pick(PAL.barrel, i, 0.6, 1.1), _gr() * TAU, 0.12 / S, 0.3, _gr());
    }
    seal(im, L.length);

    L = place(zi, CAP.anem, reef, 0.72);
    im = IM.anem;
    for (let i = 0; i < L.length; i++) {
      const p = L[i], S = rr(0.9, 2.4);
      put(im, i, stand(p.n, 0.7, rr(0, TAU)), S, S * rr(0.85, 1.2), p.x, p.y - S * 0.05, p.z,
        pick(PAL.anem, i, 0.6, 1.1), _gr() * TAU, 0.22 / S, 0.3, _gr());
    }
    seal(im, L.length);
  }

  // ---- ZONE 1: the vent fields ---------------------------------------------
  {
    const zi = 1;
    const nV = Math.min(activeVents.length, 20);
    let wi = 0, mi = 0;
    const imW = IM.worm, imM = IM.mat;
    for (let v = 0; v < nV; v++) {
      const vt = activeVents[v], bR = Math.max(vt.baseR, 0.6);
      const nW = 3 + ((_gr() * 3) | 0);
      for (let k = 0; k < nW && wi < CAP.worm; k++) {
        const a = _gr() * TAU, r = bR + rr(0.3, 2.4);
        const x = vt.x + Math.cos(a) * r, z = vt.z + Math.sin(a) * r;
        if (nearWreck(zi, x, z)) continue;
        const y = terrainH(x, z, zi), S = rr(1.1, 2.2);
        put(imW, wi++, stand(terrainNormal(x, z, zi), 0.8, _gr() * TAU), S, S * rr(0.9, 1.3), x, y - 0.03, z,
          pick(PAL.worm, k, 0.85, 1.05), _gr() * TAU, 0.15 / S, 0.3, _gr());
      }
      const nM = 4 + ((_gr() * 4) | 0);
      for (let k = 0; k < nM && mi < CAP.mat; k++) {
        const a = _gr() * TAU, r = bR + rr(0.4, 6.5);
        const x = vt.x + Math.cos(a) * r, z = vt.z + Math.sin(a) * r;
        if (nearWreck(zi, x, z)) continue;
        const y = terrainH(x, z, zi), S = rr(1.2, 4.2);
        put(imM, mi++, stand(terrainNormal(x, z, zi), 1.0, _gr() * TAU), S, S * 0.6, x, y + 0.02, z,
          pick(PAL.mat, k, 0.8, 1.05), _gr() * TAU, 0, 0, _gr());
      }
    }
    seal(imW, wi);
    seal(imM, mi);

    // crinoids: on the crust around the vent clusters, a few out on the open floor
    const seeds = [];
    for (let v = 0; v < nV; v++) seeds.push([activeVents[v].x, activeVents[v].z, rr(6, 14)]);
    const fld = fieldSeeds(zi, 10, 10, 22, 0.32, 71.7);
    const L = place(zi, CAP.crin, seeds.concat(fld), 0.6);
    const im = IM.crin;
    for (let i = 0; i < L.length; i++) {
      const p = L[i], S = rr(1.0, 2.2);
      put(im, i, stand(p.n, 0.6, rr(0, TAU)), S, S * rr(0.9, 1.4), p.x, p.y - 0.02, p.z,
        pick(PAL.crin, i, 0.6, 1.05), _gr() * TAU, 0.2 / S, 0.3, _gr());
    }
    seal(im, L.length);
  }

  // ---- ZONE 2: the abyssal plain --------------------------------------------
  {
    const zi = 2;
    const reef = reefSeeds(zi, 6, 6, 14, 0.45, 91.3);
    const field = fieldSeeds(zi, 18, 14, 34, 0.30, 23.9);
    let L = place(zi, CAP.pen, field, 0.85);
    let im = IM.pen;
    const yaw = Math.atan2(Math.cos(CUR0), Math.sin(CUR0));
    for (let i = 0; i < L.length; i++) {
      const p = L[i], S = rr(0.9, 2.2), H = S * rr(1.0, 1.6);
      const q = stand(p.n, 0.3, yaw + rr(-0.6, 0.6) + (_gr() < 0.5 ? Math.PI : 0)), ph = _gr() * TAU, w = _gr();
      const col = pick(PAL.pen, i, 0.55, 1.0);
      put(im, i, q, S, H, p.x, p.y - 0.02, p.z, col, ph, 0.28 / S, 0.3, w);
      put(penTips, i, q, S, H, p.x, p.y - 0.02, p.z, col, ph, 0.28 / S, 0.3, w);
    }
    seal(im, L.length);
    seal(penTips, L.length);

    L = place(zi, CAP.glass, reef.concat(field), 0.6);
    im = IM.glass;
    for (let i = 0; i < L.length; i++) {
      const p = L[i], S = rr(1.2, 2.6);
      put(im, i, stand(p.n, 0.6, rr(0, TAU)), S, S * rr(1.0, 1.7), p.x, p.y - 0.05, p.z,
        pick(PAL.glass, i, 0.7, 1.05), _gr() * TAU, 0.04 / S, 0.3, _gr());
    }
    seal(im, L.length);

    L = place(zi, CAP.whip, reef.concat(field), 0.55);
    im = IM.whip;
    for (let i = 0; i < L.length; i++) {
      const p = L[i], S = rr(0.8, 1.6), H = rr(3.5, 8);
      put(im, i, stand(p.n, 0.5, rr(0, TAU)), S, H, p.x, p.y - 0.05, p.z,
        pick(PAL.whip, i, 0.6, 1.05), _gr() * TAU, 0.9 / S, H * 0.04, _gr());
    }
    seal(im, L.length);
  }
}

// ------------------------------------------------------------------ frame ----
export function updateGardens(dt, t) {
  if (!built) return;
  uni.uTime.value = t;
  // Base current (flora's slow-veering CUR0) plus the eased wind published by water.js,
  // so the gardens lean the way the undercurrent pushes Sal.
  const w = windState();
  const a = CUR0 + 0.5 * Math.sin(t * 0.055);
  const wk = clamp(w.speed * 0.6, 0, 0.6);
  uni.uCur.value.set(Math.cos(a) + w.dx * wk, Math.sin(a) + w.dz * wk);
  if (scene.fog) uni.uFogD.value = scene.fog.density;
  // Depth bands: flora.js:780's law — the zone(s) around the camera only.
  const y = camera.position.y, off = !!window.__noGardens;   // __noGardens = A/B kill switch
  for (let zi = 0; zi < 3; zi++)
    zones[zi].visible = !off && y < zoneTop(zi) + 120 && y > zoneBottom(zi) - 150;
}

// Debug surface: instance counts, tri counts per type, the meshes themselves.
window.__gardens = {
  counts: () => Object.fromEntries(Object.entries(IM).map(([k, m]) => [k, m.count])),
  tris: () => Object.fromEntries(Object.entries(IM).map(([k, m]) => [k, (m.geometry.index.count / 3) | 0])),
  meshes: IM
};
