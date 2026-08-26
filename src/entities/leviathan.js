// The colossi: one continuous shader-deformed serpent per zone, carrying the sigils.
// OWNED BY: leviathan agent.
//
// Shape pipeline: a follow-the-leader anchor chain gives the swim path; an anguilliform
// travelling wave is baked into L.spine (so gameplay hit-tests and visuals agree); the
// spine plus its frames are uploaded to a tiny float texture that the body/fin vertex
// shaders sample. Per frame the CPU only touches ~53 points; all skinning is on the GPU.
import * as THREE from 'three';
import { scene, envTexDeep as envTex, camera } from '../core.js';
import { WORLD_R, ZONE_H, LEVIATHAN_CFG, zoneTop, zoneBottom } from '../config.js';
import { rng, V3, clamp, lerp } from '../lib/math.js';
import { makeGlow, glowTex, canvas2d, toTexture, noiseCanvas, normalFromHeight, seededRand, maxAniso } from '../lib/textures.js';
import { terrainH } from '../world/terrain.js';

const UP = V3(0, 1, 0);
const smooth = THREE.MathUtils.smoothstep;
const _a = V3(), _b = V3(), _t = V3(), _n = V3(), _p = V3(), _sc = V3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _col = new THREE.Color();

// Per-zone creature identity. hw/hh/hl are skull half-extents in units of cfg.size.
const ZONE = [
  { hw: 0.72, hh: 0.86, hl: 1.95, wide: 0.94, fin: 1.45, thorn: 0, crown: 0,
    teeth: 0.44, teethN: 11, hide: 0x2e5260, hideLo: 0x0b1a22, bio: 0x8ff4ff, bioI: 1.25,
    crack: 0x2fb9d8, crackI: 0.20, rim: 0x6fdcff, rimI: 0.75, eye: 0xd6f8ff, rough: 0.40 },
  { hw: 0.82, hh: 0.94, hl: 1.80, wide: 1.03, fin: 0.80, thorn: 1, crown: 7,
    teeth: 0.58, teethN: 13, hide: 0x3d2c62, hideLo: 0x120a24, bio: 0xc48bff, bioI: 1.05,
    crack: 0x8a44ff, crackI: 0.55, rim: 0xa86fff, rimI: 0.62, eye: 0xecc4ff, rough: 0.50 },
  { hw: 0.94, hh: 1.00, hl: 1.68, wide: 1.16, fin: 0.95, thorn: 2, crown: 9,
    teeth: 0.64, teethN: 15, hide: 0x452018, hideLo: 0x120503, bio: 0xff9440, bioI: 1.35,
    crack: 0xff5a10, crackI: 1.9, rim: 0xff7c2a, rimI: 0.80, eye: 0xffd394, rough: 0.62 }
];

// ---------------------------------------------------------------- textures

// Seeded (house mulberry32): a sleeper's hide is part of its identity — it must be the
// same animal every boot and every voyage back, not a fresh roll of Math.random.
let _detail = null;
const detailCv = () => (_detail || (_detail = noiseCanvas(256, 5, 1, seededRand(0x1E71A7A4))));

// Overlapping teardrop scales, drawn wrapped at the edges so the sheet tiles.
function scaleHeight(S, cols, rows) {
  const { canvas, ctx } = canvas2d(S);
  ctx.fillStyle = '#6a6a6a'; ctx.fillRect(0, 0, S, S);
  const cw = S / cols, ch = S / rows;
  const one = (x, y) => {
    const g = ctx.createRadialGradient(x, y - ch * 0.16, ch * 0.06, x, y, ch * 0.95);
    g.addColorStop(0, 'rgba(255,255,255,.92)');
    g.addColorStop(0.55, 'rgba(150,150,150,.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, cw * 0.62, ch * 0.74, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.40)'; ctx.lineWidth = Math.max(1, cw * 0.05); ctx.stroke();
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = (c + (r & 1 ? 0.5 : 0)) * cw + cw * 0.5, y = r * ch + ch * 0.5;
    one(x, y);
    if (x < cw) one(x + S, y);
    if (x > S - cw) one(x - S, y);
    if (y < ch) one(x, y + S);
    if (y > S - ch) one(x, y - S);
  }
  return canvas;
}

function hideMaps(Z) {
  const S = 512;
  const h = scaleHeight(S, 26, 34);
  const nrmCv = normalFromHeight(h, 1.5);
  const hd = h.getContext('2d').getImageData(0, 0, S, S).data;
  const { canvas: nc, ctx: nx } = canvas2d(S);
  nx.drawImage(detailCv(), 0, 0, S, S);
  const nd = nx.getImageData(0, 0, S, S).data;
  const { canvas: alb, ctx: ac } = canvas2d(S), ai = ac.createImageData(S, S);
  const { canvas: rgh, ctx: rc } = canvas2d(S), ri = rc.createImageData(S, S);
  const lo = new THREE.Color(Z.hideLo), hi = new THREE.Color(Z.hide);
  for (let i = 0, p = 0; i < S * S; i++, p += 4) {
    const v = hd[p] / 255, nn = nd[p] / 255;
    // mottle dominates; the scale field only tints, so the tiling never reads as a grid
    const k = clamp(0.10 + v * 0.42 + nn * 0.62 - 0.14, 0, 1);
    ai.data[p] = lerp(lo.r, hi.r, k) * 255;
    ai.data[p + 1] = lerp(lo.g, hi.g, k) * 255;
    ai.data[p + 2] = lerp(lo.b, hi.b, k) * 255;
    ai.data[p + 3] = 255;
    const w = clamp((0.40 + 0.34 * (1 - v) + 0.42 * nn) * (0.55 + Z.rough), 0, 1) * 255;
    ri.data[p] = ri.data[p + 1] = ri.data[p + 2] = w;
    ri.data[p + 3] = 255;
  }
  ac.putImageData(ai, 0, 0); rc.putImageData(ri, 0, 0);
  return {
    map: toTexture(alb, 1, true), normalMap: toTexture(nrmCv),
    roughnessMap: toTexture(rgh), detail: toTexture(nc)
  };
}

// A carved ward: ring, ticks and a mirrored angular glyph. White mask, tinted by the material.
function runeTex(seed) {
  const { canvas, ctx } = canvas2d(128);
  let s = Math.abs(seed * 9301 + 49297) % 233280;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  ctx.translate(64, 64);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff';
  ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(0, 0, 50, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(0, 0, 41, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2, r1 = i % 4 ? 56 : 61;
    ctx.lineWidth = i % 4 ? 1.6 : 4;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 50, Math.sin(a) * 50);
    ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.stroke();
  }
  ctx.lineWidth = 5.5;
  for (let k = 0; k < 4; k++) {
    const a0 = rnd() * 6.28, r0 = 7 + rnd() * 22, a1 = a0 + (rnd() - 0.5) * 2.4, r1 = 9 + rnd() * 28;
    for (const mr of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(Math.cos(a0) * r0 * mr, Math.sin(a0) * r0);
      ctx.lineTo(Math.cos(a1) * r1 * mr, Math.sin(a1) * r1);
      ctx.stroke();
    }
  }
  ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, Math.PI * 2); ctx.fill();
  const tx = new THREE.CanvasTexture(canvas);
  tx.anisotropy = maxAniso();
  return tx;
}

// ---------------------------------------------------------------- GLSL

// Shared by body + fins: samples the spine texture and evaluates the tube surface.
// bodyR/sect are mirrored by jsSect() below — keep the two in sync.
const DEFORM = /* glsl */`
uniform sampler2D uSpine;
uniform float uCount, uSize, uTime, uAgit, uWide, uFin;
varying float vU, vA;
vec3 spn(float i, float row){
  return texture2D(uSpine, vec2((clamp(i,0.0,uCount-1.0)+0.5)/uCount, (row+0.5)/3.0)).xyz;
}
vec3 cpos(float s){
  float i = floor(s), f = s - i;
  vec3 p0=spn(i-1.0,0.0), p1=spn(i,0.0), p2=spn(i+1.0,0.0), p3=spn(i+2.0,0.0);
  return 0.5*(2.0*p1 + (p2-p0)*f + (2.0*p0-5.0*p1+4.0*p2-p3)*f*f + (3.0*p1-p0-3.0*p2+p3)*f*f*f);
}
float bodyR(float u){
  return (0.60+0.46*smoothstep(0.0,0.11,u)) * pow(max(1.0-u,0.0),0.78) * (1.0-0.82*smoothstep(0.76,1.0,u));
}
void frame(float u, out vec3 P, out vec3 N, out vec3 B){
  float s = u*(uCount-1.0), i = floor(s), f = s-i;
  P = cpos(s);
  N = normalize(mix(spn(i,1.0), spn(i+1.0,1.0), f));
  B = normalize(mix(spn(i,2.0), spn(i+1.0,2.0), f));
}
vec2 sect(float u){                       // (dorso-ventral half-height, lateral half-width)
  float r = bodyR(u)*uSize;
  float rid = 1.0 + 0.009*sin(u*(uCount-1.0)*6.2831853) + 0.006*sin(u*81.0);
  return vec2(r*(1.14+0.24*u), r*(0.74-0.26*u)*uWide)*rid;
}
vec3 surf(float u, float a){
  vec3 P,N,B; frame(u,P,N,B);
  vec2 hw = sect(u);
  float ca = cos(a), sa = sin(a), vent = max(0.0,-ca);
  float h = hw.x*(1.0-0.20*vent*vent);
  float w = hw.y*(1.0+0.13*vent)*(1.0+0.05*sin(a*7.0));
  return P + N*(ca*h) + B*(sa*w);
}
float finH(float u){
  float on = smoothstep(0.04,0.17,u);
  float bd = 0.42+0.86*smoothstep(0.14,0.72,u);
  float fluke = 1.0 + 2.5*exp(-pow((u-0.915)/0.072,2.0));
  float tip = 1.0-smoothstep(0.985,1.0,u);
  return on*bd*fluke*tip*(1.0+0.10*sin(u*105.0))*uFin;
}
vec3 finPos(float u, float tt, float d){
  vec3 P,N,B; frame(u,P,N,B);
  vec2 hw = sect(u);
  float vs = d>0.0 ? 1.0 : mix(0.34,1.0,smoothstep(0.68,0.90,u));
  float H = finH(u)*uSize*vs;
  float rip = sin(u*24.0 - uTime*(3.2+uAgit*4.5))*H*0.30*pow(tt,1.7);
  return P + N*(d*(hw.x*0.94 + H*tt)) + B*rip;
}`;

// Cracks (noise iso-bands) plus a fresnel rim — shared by body and head.
const HIDE_FRAG = /* glsl */`
uniform sampler2D uDetail;
uniform float uTime, uAgit, uCrackI, uRimI, uFade;
uniform vec3 uCrackC, uRimC;
float crackMask(vec2 q){
  float n = texture2D(uDetail, q*0.55).r;
  float b = smoothstep(0.47,0.505,n)*(1.0-smoothstep(0.525,0.575,n));
  return b*(0.55+0.75*texture2D(uDetail, q*1.9+0.31).r);
}`;

// ---------------------------------------------------------------- geometry

// Tube parameterised only by (u, angle) — the vertex shader supplies every position.
function tubeGeo(rings, radial) {
  // positions are placeholders; rebuildBody() writes the real surface each frame
  const g = new THREE.BufferGeometry();
  const nv = (rings + 1) * (radial + 1);
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), nor = new Float32Array(nv * 3);
  let k = 0;
  for (let i = 0; i <= rings; i++) for (let j = 0; j <= radial; j++, k++) {
    const u = i / rings, a = j / radial;
    uv[k * 2] = u; uv[k * 2 + 1] = a;
    pos[k * 3] = u; pos[k * 3 + 1] = Math.cos(a * 6.2832); pos[k * 3 + 2] = Math.sin(a * 6.2832);
    nor[k * 3 + 1] = 1;
  }
  const idx = [];
  for (let i = 0; i < rings; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(V3(), 1e4);
  g.userData.rings = rings;
  g.userData.radial = radial;
  return g;
}

// Two membrane strips (dorsal + ventral) running the length of the body.
function finGeo(rings) {
  const g = new THREE.BufferGeometry();
  const nv = (rings + 1) * 2 * 2;
  const pos = new Float32Array(nv * 3);
  const aU = new Float32Array(nv), aT = new Float32Array(nv), aF = new Float32Array(nv);
  const idx = [];
  let k = 0;
  for (let side = 0; side < 2; side++) {
    const base = k;
    for (let i = 0; i <= rings; i++) for (let j = 0; j < 2; j++, k++) {
      aU[k] = i / rings; aT[k] = j; aF[k] = side ? -1 : 1;
      pos[k * 3] = i / rings;
    }
    for (let i = 0; i < rings; i++) {
      const a = base + i * 2;
      idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aU', new THREE.BufferAttribute(aU, 1));
  g.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  g.setAttribute('aFin', new THREE.BufferAttribute(aF, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(V3(), 1e4);
  return g;
}

// Sculpted skull: long wedge, brow ridge over the eye, jaw-muscle mass, flat palate.
function skullGeo(Z) {
  const g = new THREE.SphereGeometry(1, 26, 18);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const tt = v.z * 0.5 + 0.5, sn = smooth(tt, 0.42, 1.0);
    let x = v.x * (1 - 0.60 * sn) * Z.hw;
    let y = v.y * (1 - 0.40 * sn) * Z.hh;
    const brow = Math.exp(-Math.pow((tt - 0.63) / 0.11, 2)) * Math.max(0, v.y) * Math.min(1, Math.abs(v.x) * 2.2);
    y += brow * 0.34 * Z.hh;
    x += Math.sign(v.x) * brow * 0.20 * Z.hw;
    const jm = Math.exp(-Math.pow((tt - 0.27) / 0.17, 2)) * clamp(0.55 - v.y * 0.5, 0, 1);
    x += Math.sign(v.x) * jm * 0.26 * Z.hw;
    if (v.y > 0) y -= Math.pow(v.y, 3) * 0.20 * Z.hh;
    y = Math.max(y, -(0.30 - 0.13 * sn) * Z.hh);        // flat palate the mandible seats against
    p.setXYZ(i, x, y, v.z * Z.hl);
  }
  g.translate(0, 0, Z.hl * 0.86);
  g.computeVertexNormals();
  return g;
}

function jawGeo(Z) {
  const g = new THREE.SphereGeometry(1, 22, 12);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const tt = v.z * 0.5 + 0.5, sn = smooth(tt, 0.38, 1.0);
    const x = v.x * (1 - 0.64 * sn) * Z.hw * 0.90;
    let y = Math.min(v.y, 0.05) * Z.hh * 0.40;
    y -= Math.exp(-Math.pow((tt - 0.30) / 0.24, 2)) * Math.max(0, -v.y) * 0.30 * Z.hh;   // throat pouch
    p.setXYZ(i, x, y, v.z * Z.hl * 0.92);
  }
  g.translate(0, 0, Z.hl * 0.88);
  g.computeVertexNormals();
  return g;
}

// One instanced row of teeth clamped to the jaw line. dir=+1 upper (points down), -1 lower.
function teethMesh(Z, mat, dir) {
  const geo = new THREE.ConeGeometry(0.032, 1, 5);
  geo.translate(0, 0.5, 0);
  const n = Z.teethN, im = new THREE.InstancedMesh(geo, mat, n * 2);
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), z = Z.hl * (0.34 + 1.24 * f);
    // follow the jaw line: the sphere narrows toward the snout, so tuck the row inside it
    const uz = z / Z.hl - 0.86, w = Math.sqrt(Math.max(0.04, 1 - uz * uz));
    const sn = smooth(uz * 0.5 + 0.5, 0.42, 1.0);
    const hx = Z.hw * (1 - 0.60 * sn) * w * 0.80;
    const len = Z.teeth * (0.95 - 0.42 * f) * (i & 1 ? 0.6 : 1);
    for (let s = 0; s < 2; s++) {
      const sx = s ? 1 : -1;
      // the mandible is narrower than the skull, so its row tucks in further
      _p.set(sx * hx * (dir > 0 ? 1 : 0.88), dir > 0 ? -0.26 * Z.hh : 0.0, z);
      _q.setFromEuler(new THREE.Euler(dir > 0 ? Math.PI : 0, 0, sx * 0.12 * dir));
      im.setMatrixAt(i * 2 + s, _m.compose(_p, _q, _sc.set(1, len, 1)));
    }
  }
  im.instanceMatrix.needsUpdate = true;
  return im;
}

// ---------------------------------------------------------------- build

// ---- SIGIL LIGHT POOL --------------------------------------------------------
// enterZone disposes and remakes the leviathan LIVE mid-dive. When each ward owned
// its own PointLight the scene's LIGHT COUNT changed at that moment (3/4/5 per zone)
// and three recompiled every lit material in the game at the worst possible time —
// the exact hazard the vents' single shared PointLight exists to avoid. The wards now
// borrow from a fixed pool of 5 (the largest authored nSigils), created on the first
// build, added to the scene ONCE and NEVER removed; disposeLeviathan parks them at
// intensity 0. Decay is 2.0 (physical): the calming flash used to run decay 1.8,
// which splashed light across the whole zone; 2.0 keeps the close-range punch and
// shrinks the far spill (peak retuned in updateSigilFX to match by eye up close).
const SIGIL_POOL_N = 5;
const sigilPool = [];
function ensureSigilPool() {
  if (sigilPool.length) return;
  for (let k = 0; k < SIGIL_POOL_N; k++) {
    const pl = new THREE.PointLight(0xffe8a8, 0, 50, 2.0);
    sigilPool.push(pl);
    scene.add(pl);
  }
}

export function makeLeviathan(idx, over) {
  // `over` is THE CHART's authored sleeper row for a remote site (nSigils/hue/name).
  // It merges over the shipped config, and ...c below spreads it through everything —
  // the NSIG shader define, the ward count, the shown name. Home passes undefined.
  let c = over ? Object.assign({}, LEVIATHAN_CFG[idx], over) : LEVIATHAN_CFG[idx];
  const Z = ZONE[idx];
  // A chart row asking for more wards than the pool holds would force per-build
  // PointLights and a scene light-count change mid-voyage — clamp instead.
  if (c.nSigils > SIGIL_POOL_N) c = Object.assign({}, c, { nSigils: SIGIL_POOL_N });
  ensureSigilPool();
  const grp = new THREE.Group();
  const yMid = (zoneTop(idx) + zoneBottom(idx)) / 2;
  const n = c.segs, NP = n + 1, gap = c.size * 0.62;

  const L = {
    ...c, idx, Z, t: Math.random() * 100, agitation: 0, calmed: false, calmT: 0,
    head: V3(rng(-80, 80), yMid, rng(-80, 80)), pitch: 0, gap, swim: 1,
    roll: 0, wave: 0, mouth: 0.06, lunge: 0, lungeCd: 4, flare: 0,
    spine: [], anchor: [], fN: [], fB: [], fT: [], sigils: [], meshes: [], grp
  };
  L.ang = Math.atan2(-L.head.z, -L.head.x);
  const fwd = V3(Math.cos(L.ang), 0, Math.sin(L.ang));
  for (let i = 0; i < n; i++) {
    const p = L.head.clone().addScaledVector(fwd, -(i + 1) * gap);
    L.spine.push(p.clone());
    L.anchor.push(p);
  }
  for (let i = 0; i < NP; i++) {
    L.fN.push(V3(0, 1, 0));
    L.fB.push(V3().crossVectors(fwd.clone().negate(), UP).normalize());
    L.fT.push(fwd.clone().negate());
  }

  // spine texture: row0 position, row1 dorsal, row2 lateral
  L.sData = new Float32Array(NP * 3 * 4);
  L.sTex = new THREE.DataTexture(L.sData, NP, 3, THREE.RGBAFormat, THREE.FloatType);
  L.sTex.minFilter = L.sTex.magFilter = THREE.NearestFilter;
  L.sTex.generateMipmaps = false;
  L.sTex.needsUpdate = true;

  const sigArr = [];
  const sigFX = [];
  for (let i = 0; i < c.nSigils; i++) sigArr.push(new THREE.Vector3(-1, 0, 0));
  for (let i = 0; i < c.nSigils; i++) sigFX.push(new THREE.Vector2(0, 0));
  const U = L.uni = {
    uSpine: { value: L.sTex }, uCount: { value: NP }, uSize: { value: c.size },
    uTime: { value: 0 }, uAgit: { value: 0 }, uWide: { value: Z.wide }, uFin: { value: Z.fin },
    uDetail: { value: null }, uCrackC: { value: new THREE.Color(Z.crack) }, uCrackI: { value: Z.crackI },
    uRimC: { value: new THREE.Color(Z.rim) }, uRimI: { value: Z.rimI }, uFade: { value: 1 },
    uBio: { value: new THREE.Color(Z.bio) }, uBioI: { value: Z.bioI },
    uSigC: { value: new THREE.Color(0xffe8a8) }, uSig: { value: sigArr },
    // sigil shockwave (x = ring radius in u, y = amplitude), nose-to-tail calm wave, full-body flare
    uSigFX: { value: sigFX }, uWave: { value: new THREE.Vector2(-1, 0) }, uFlare: { value: 0 }
  };

  const tex = hideMaps(Z);
  U.uDetail.value = tex.detail;
  const rptU = Math.max(6, Math.round(n * gap / (c.size * 1.6)));
  const rptA = 4;
  for (const k of ['map', 'normalMap', 'roughnessMap']) tex[k].repeat.set(rptU, rptA);
  tex.detail.repeat.set(rptU * 0.22, rptA * 0.22);   // cracks read at a much larger scale than scales

  // ---- body ----
  const bodyMat = new THREE.MeshStandardMaterial({
    map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.roughnessMap,
    normalScale: new THREE.Vector2(0.75, 0.75), roughness: 1, metalness: 0.05,
    envMap: envTex, envMapIntensity: 0.30
  });
  bodyMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + DEFORM)
      // Positions and normals now arrive as real attributes from rebuildBody();
      // the shader only forwards the surface parameters the fragment stage needs.
      .replace('#include <beginnormal_vertex>', /* glsl */`
        #include <beginnormal_vertex>
        vU = uv.x; vA = uv.y*6.2831853;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n#define NSIG ${c.nSigils}\n` + HIDE_FRAG + `
        uniform vec3 uBio, uSigC, uSig[NSIG];
        uniform float uBioI, uFlare;
        uniform vec2 uSigFX[NSIG], uWave;
        varying float vU, vA;`)
      .replace('#include <emissivemap_fragment>', /* glsl */`
        #include <emissivemap_fragment>
        float flank = pow(abs(sin(vA)),3.0);
        float trav = sin(vU*20.0 - uTime*(1.2+uAgit*2.6))*sin(vU*7.0+1.7);
        float stripe = smoothstep(0.35,0.95,trav)*flank;
        float belly = pow(max(0.0,-cos(vA)),2.2)*(0.42+0.30*sin(uTime*0.9+vU*6.0));
        float cr = crackMask(vMapUv)*(0.55+0.45*sin(uTime*1.7+vU*9.0))*(0.6+0.9*uAgit);
        float fres = pow(1.0-abs(dot(normalize(vViewPosition), normal)),3.0);
        vec3 add = uBio*(stripe*uBioI*(1.0+2.2*uFlare) + belly*(0.42+1.1*uFlare)) + uCrackC*(cr*uCrackI) + uRimC*(fres*uRimI);
        for(int i=0;i<NSIG;i++){
          float d = vU-uSig[i].x;
          add += uSigC*uSig[i].y*exp(-d*d*150.0)*(0.35+0.65*max(0.0,cos(vA-uSig[i].z)));
          // travelling ring of light through the hide, brightest along the scale seams
          float rd = abs(d)-uSigFX[i].x;
          float ring = exp(-rd*rd*900.0)*uSigFX[i].y;
          add += mix(uSigC, uBio, 0.35)*ring*(0.55+0.85*abs(sin(vA*1.5)))*(0.7+0.8*crackMask(vMapUv));
        }
        float wd = vU-uWave.x;
        add += mix(uSigC, uBio, 0.6)*exp(-wd*wd*90.0)*uWave.y*(0.45+0.55*flank);
        totalEmissiveRadiance += add*uFade;
        diffuseColor.rgb *= 0.55+0.45*uFade;`);
  };
  const rings = clamp(n * 3, 64, 168);
  const bodyGeo = tubeGeo(rings, 14);
  L.bodyGeo = bodyGeo;                     // rebuilt on the CPU each frame by rebuildBody()
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.frustumCulled = false;              // the tube spans the whole spine; bounds are meaningless
  body.castShadow = true;
  grp.add(body);

  // ---- dorsal / ventral membranes ----
  // Alpha-hashed cutout, NOT blended: membranes render in the opaque pass with depth
  // writes on, so fin-over-fin ordering can never be wrong where the body coils.
  const finMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(Z.hide).multiplyScalar(1.5), roughness: 0.42, metalness: 0,
    side: THREE.DoubleSide, transparent: false, opacity: 1,
    emissive: new THREE.Color(Z.bio).multiplyScalar(0.10)
  });
  finMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + DEFORM + '\nattribute float aU, aT, aFin;\nvarying float vT;')
      .replace('#include <beginnormal_vertex>', /* glsl */`
        vec3 fP = finPos(aU,aT,aFin);
        vec3 objectNormal = normalize(cross(finPos(min(aU+0.004,1.0),aT,aFin)-fP, finPos(aU,aT+0.04,aFin)-fP));
        vU = aU; vA = aT; vT = aT;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = fP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        uniform vec3 uBio, uRimC;
        uniform float uTime, uBioI, uFade, uRimI;
        varying float vU, vA, vT;`)
      .replace('#include <emissivemap_fragment>', /* glsl */`
        #include <emissivemap_fragment>
        float vein = smoothstep(0.72,1.0,sin(vU*150.0)*sin(vU*23.0+1.1));
        float edge = smoothstep(0.55,1.0,vT);
        float pulse = 0.5+0.5*sin(uTime*1.6 - vU*11.0);
        totalEmissiveRadiance += (uBio*(vein*0.75+edge*0.30*pulse)*uBioI + uRimC*edge*uRimI*0.25)*uFade;
        // ordered 4x4 Bayer threshold in screen space: stochastic cutout, so the opaque
        // pass resolves depth correctly and no blend ordering exists to get wrong.
        // ~45% base coverage keeps the sheet reading as translucent membrane; the veins
        // and the outer edge fringe stay near-solid so the shape still reads.
        float cov = ((0.46-0.24*vT) + 0.42*vein)*uFade;
        vec2 fc = floor(gl_FragCoord.xy);
        float bay = fract(dot(fc, vec2(0.7548776662, 0.5698402909)));   // R2 low-discrepancy
        if (cov < bay*0.94 + 0.03) discard;
        diffuseColor.a = 1.0;`);
  };
  const fins = new THREE.Mesh(finGeo(rings), finMat);
  fins.frustumCulled = false;
  grp.add(fins);

  // Head membranes need a plain material: finMat's vertex shader reads aU/aT/aFin and
  // would collapse any geometry that lacks them (three shares one program per material).
  const membMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(Z.hide).multiplyScalar(1.5), roughness: 0.42, metalness: 0,
    side: THREE.DoubleSide, transparent: true, opacity: 0.62, depthWrite: false,
    emissive: new THREE.Color(Z.bio).multiplyScalar(0.12),
    // r163+ renders transparent DoubleSide in two passes (back then front); with
    // depthWrite off both passes land, doubling the membrane's apparent opacity.
    forceSinglePass: true
  });

  // ---- bioluminescent nodes: the silhouette that reads first through fog ----
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
  pg.boundingSphere = new THREE.Sphere(V3(), 1e4);
  L.glow = new THREE.Points(pg, new THREE.PointsMaterial({
    map: glowTex, size: c.size * 2.6, sizeAttenuation: true, color: new THREE.Color(Z.bio),
    transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending
  }));
  L.glow.frustumCulled = false;
  grp.add(L.glow);

  // ---- ember burst pool: idle at zero cost (mesh hidden, no integration) ----
  const EM = 96;                            // 40 per burst; ring buffer covers overlap
  const emPos = new Float32Array(EM * 3), emLife = new Float32Array(EM), emSz = new Float32Array(EM);
  const emVel = new Float32Array(EM * 3);
  const emGeo = new THREE.BufferGeometry();
  emGeo.setAttribute('position', new THREE.BufferAttribute(emPos, 3));
  emGeo.setAttribute('aLife', new THREE.BufferAttribute(emLife, 1));
  emGeo.setAttribute('aSize', new THREE.BufferAttribute(emSz, 1));
  emGeo.boundingSphere = new THREE.Sphere(V3(), 1e4);
  const emMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: glowTex }, uPS: { value: c.size * 170 } },
    vertexShader: /* glsl */`
      attribute float aLife, aSize;
      uniform float uPS;
      varying float vL;
      void main(){
        vL = aLife;
        vec4 mv = modelViewMatrix*vec4(position,1.0);
        gl_Position = projectionMatrix*mv;
        gl_PointSize = aSize*uPS/max(-mv.z, 0.5);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uTex;
      varying float vL;
      void main(){
        if (vL <= 0.0) discard;
        float a = texture2D(uTex, gl_PointCoord).a;
        vec3 col = mix(vec3(1.0,0.42,0.12), vec3(1.0,0.94,0.78), vL);
        gl_FragColor = vec4(col, a*vL*(0.35+0.65*vL)*1.25);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  L.embers = new THREE.Points(emGeo, emMat);
  L.embers.frustumCulled = false;
  L.embers.visible = false;
  L.em = { pos: emPos, vel: emVel, life: emLife, sz: emSz, cap: EM, head: 0, alive: 0 };
  grp.add(L.embers);

  // ---- fake contact shadows: soft dark blobs under the lowest spine points ----
  const { canvas: bc, ctx: bx } = canvas2d(64);
  const bg = bx.createRadialGradient(32, 32, 0, 32, 32, 32);
  bg.addColorStop(0, 'rgba(0,0,0,0.85)');
  bg.addColorStop(0.5, 'rgba(0,0,0,0.42)');
  bg.addColorStop(1, 'rgba(0,0,0,0)');
  bx.fillStyle = bg; bx.fillRect(0, 0, 64, 64);
  L.blobTex = new THREE.CanvasTexture(bc);
  L.blobs = [];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      // fog off: fog would tint the blob to the water colour and erase it, so instead it
      // fades out with camera distance — a contact cue only matters up close.
      map: L.blobTex, transparent: true, opacity: 0, depthWrite: false, color: 0x000000, fog: false
    }));
    b.rotation.x = -Math.PI / 2;
    b.visible = false;
    b.renderOrder = -1;
    scene.add(b);
    L.blobs.push(b);
  }

  // ---- head ----
  // the skull has sphere UVs, not tube UVs, so it needs its own repeat
  const hTex = {};
  for (const k of ['map', 'normalMap', 'roughnessMap']) {
    hTex[k] = tex[k].clone();
    hTex[k].repeat.set(3.2, 2.4);
    hTex[k].needsUpdate = true;
  }
  const headMat = new THREE.MeshStandardMaterial({
    map: hTex.map, normalMap: hTex.normalMap, roughnessMap: hTex.roughnessMap,
    normalScale: new THREE.Vector2(0.7, 0.7), roughness: 1, metalness: 0.06,
    envMap: envTex, envMapIntensity: 0.35
  });
  headMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + HIDE_FRAG)
      .replace('#include <emissivemap_fragment>', /* glsl */`
        #include <emissivemap_fragment>
        float cr = crackMask(vMapUv)*(0.55+0.45*sin(uTime*1.7))*(0.6+0.9*uAgit);
        float fres = pow(1.0-abs(dot(normalize(vViewPosition), normal)),3.0);
        totalEmissiveRadiance += (uCrackC*cr*uCrackI + uRimC*fres*uRimI)*uFade;
        diffuseColor.rgb *= 0.55+0.45*uFade;`);
  };
  const head = new THREE.Group();
  head.scale.setScalar(c.size);
  const skull = new THREE.Mesh(skullGeo(Z), headMat);
  skull.castShadow = true;
  head.add(skull);

  const boneMat = new THREE.MeshStandardMaterial({
    color: 0xd8ccb4, roughness: 0.28, metalness: 0.05, envMap: envTex, envMapIntensity: 0.9,
    emissive: new THREE.Color(Z.bio).multiplyScalar(0.05)
  });
  head.add(teethMesh(Z, boneMat, 1));

  const jaw = new THREE.Mesh(jawGeo(Z), headMat);
  jaw.position.set(0, -0.26 * Z.hh, -Z.hl * 0.86);
  jaw.castShadow = true;
  jaw.add(teethMesh(Z, boneMat, -1));
  head.add(jaw);
  L.jaw = jaw;

  // the throat: furnace glow in zone 2, cold light elsewhere — only seen down an open gullet
  const maw = new THREE.Mesh(new THREE.SphereGeometry(Z.hw * 0.30, 10, 8), new THREE.MeshBasicMaterial({
    color: new THREE.Color(Z.crack), transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  maw.position.set(0, -0.24 * Z.hh, Z.hl * 0.18);
  head.add(maw);
  L.maw = maw;

  // eyes: dark wet ball, glowing iris, fixed catchlight, halo
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x05080c, roughness: 0.05, metalness: 0.3, envMap: envTex, envMapIntensity: 1.6 });
  const irisMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(Z.eye) });
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eR = Z.hh * 0.30;
  L.eyes = [];
  for (const sx of [-1, 1]) {
    const e = new THREE.Group();
    e.position.set(sx * Z.hw * 0.70, Z.hh * 0.26, Z.hl * 0.72);
    e.add(new THREE.Mesh(new THREE.SphereGeometry(eR, 14, 12), eyeMat));
    const iris = new THREE.Mesh(new THREE.SphereGeometry(eR * 0.42, 12, 10), irisMat);
    iris.position.set(sx * eR * 0.76, 0, eR * 0.30);
    e.add(iris);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(eR * 0.085, 6, 5), hlMat);
    hl.position.set(sx * eR * 0.66, eR * 0.60, eR * 0.58);
    e.add(hl);
    const halo = makeGlow(new THREE.Color(Z.eye), eR * 5);
    halo.material.opacity = 0.45;
    e.add(halo);
    head.add(e);
    L.eyes.push({ grp: e, iris, halo });
  }

  // gill slits recessed into the nape, just behind the jaw hinge
  const gillMat = new THREE.MeshStandardMaterial({
    color: 0x04060a, roughness: 0.75,
    emissive: new THREE.Color(Z.bio).multiplyScalar(0.10)
  });
  const gillGeo = new THREE.BoxGeometry(0.06 * Z.hw, 0.30 * Z.hh, 0.035 * Z.hl);
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
    const zz = -0.06 + i * 0.13;                                   // unit-sphere z of this slit
    const halfW = Z.hw * (1 - 0.60 * smooth(zz * 0.5 + 0.5, 0.42, 1.0)) * Math.sqrt(1 - zz * zz);
    const g = new THREE.Mesh(gillGeo, gillMat);
    g.position.set(sx * halfW * 0.94, -0.05 * Z.hh, Z.hl * (zz + 0.86));
    g.rotation.set(0, 0, sx * 0.16);
    g.scale.y = 1 - 0.16 * i;
    head.add(g);
  }

  // crown of horns (zones 1-2)
  if (Z.crown) {
    const hornGeo = new THREE.ConeGeometry(0.10, 1, 5);
    hornGeo.translate(0, 0.5, 0);
    const crown = new THREE.InstancedMesh(hornGeo, boneMat, Z.crown * 2);
    for (let i = 0; i < Z.crown; i++) {
      const f = i / (Z.crown - 1);
      for (let s = 0; s < 2; s++) {
        const sx = s ? 1 : -1;
        _p.set(sx * Z.hw * (0.30 + 0.45 * f), Z.hh * (0.70 - 0.26 * f), Z.hl * (0.66 - 0.95 * f));
        _q.setFromEuler(new THREE.Euler(-0.55 - 0.5 * f, 0, sx * (0.35 + 0.5 * f)));
        const ln = Z.hh * (1.5 - 0.7 * f) * (Z.thorn === 2 ? 1.25 : 1);
        crown.setMatrixAt(i * 2 + s, _m.compose(_p, _q, _sc.set(1, ln, 1)));
      }
    }
    crown.instanceMatrix.needsUpdate = true;
    head.add(crown);
  }

  // ribbon-eel nostril flares
  if (idx === 0) for (const sx of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.10 * Z.hw, 0.42 * Z.hl, 6, 1, true), membMat);
    f.position.set(sx * Z.hw * 0.22, Z.hh * 0.08, Z.hl * 1.70);
    f.rotation.set(Math.PI / 2 - 0.5, 0, sx * 0.4);
    head.add(f);
  }

  // pectoral fins just behind the skull
  const pecGeo = new THREE.CircleGeometry(1, 12, -0.9, 1.8);
  pecGeo.scale(1, 0.55, 1);
  L.pecs = [];
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(pecGeo, membMat);
    p.scale.setScalar(Z.hl * 0.8);
    p.position.set(sx * Z.hw * 0.82, -0.10 * Z.hh, -Z.hl * 0.2);
    head.add(p);
    L.pecs.push({ mesh: p, sx });
  }
  grp.add(head);
  L.headGrp = head;

  // ---- dorsal thorns (zones 1-2), CPU-instanced along the spine ----
  if (Z.thorn) {
    const tg = new THREE.ConeGeometry(0.22, 1, 5);
    tg.translate(0, 0.5, 0);
    L.thorns = new THREE.InstancedMesh(tg, boneMat, n);
    L.thorns.frustumCulled = false;
    grp.add(L.thorns);
  }

  // ---- sigils: iron wards bolted through the hide ----
  const step = Math.floor(n / (c.nSigils + 1));
  const ringGeo = new THREE.TorusGeometry(0.62, 0.11, 6, 18);
  const boltGeo = new THREE.ConeGeometry(0.10, 0.42, 5);
  boltGeo.translate(0, 0.21, 0);
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x241d16, roughness: 0.42, metalness: 0.85, envMap: envTex, envMapIntensity: 1.1 });
  const socketMat = new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.9, metalness: 0.2 });
  const socketGeo = new THREE.CircleGeometry(0.60, 16);
  for (let i = 1; i <= c.nSigils; i++) {
    const sg = new THREE.Group();
    sg.scale.setScalar(c.size * 0.95);
    sg.add(new THREE.Mesh(ringGeo, ironMat));
    const socket = new THREE.Mesh(socketGeo, socketMat);
    socket.position.z = -0.05;
    sg.add(socket);
    const bolts = new THREE.InstancedMesh(boltGeo, ironMat, 6);
    for (let b = 0; b < 6; b++) {
      const a = b / 6 * 6.2832;
      _p.set(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.04);
      _q.setFromUnitVectors(UP, _a.set(Math.cos(a) * 0.45, Math.sin(a) * 0.45, 1).normalize());
      bolts.setMatrixAt(b, _m.compose(_p, _q, _sc.set(1, 1, 1)));
    }
    bolts.instanceMatrix.needsUpdate = true;
    sg.add(bolts);
    const rune = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), new THREE.MeshBasicMaterial({
      map: runeTex(idx * 17 + i * 7), color: 0xffe8a8, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    rune.position.z = 0.08;
    sg.add(rune);
    // Borrowed pool slot — the light lives on the SCENE, not on grp (placeSigil writes
    // world-space positions, and grp never moves off the origin, so the coords agree).
    const light = sigilPool[i - 1];
    light.intensity = 0;
    const halo = makeGlow(0xffe8a8, 0);
    grp.add(halo, sg);
    L.sigils.push({
      seg: i * step, lit: false, grp: sg, mesh: sg, rune, light, halo,
      ang: (i % 2 ? 0.42 : -0.42), pulse: Math.random() * 7, flashT: 9
    });
  }
  for (let i = 0; i < c.nSigils; i++) sigArr[i].set((L.sigils[i].seg + 1) / n, 0, L.sigils[i].ang);

  L.body = body; L.fins = fins;
  L.meshes = [body, fins, head];
  updateSpine(L);
  scene.add(grp);
  return L;
}

export function disposeLeviathan(L) {
  if (!L) return;
  // Return the borrowed sigil lights to the pool: park at intensity 0, but NEVER
  // remove from the scene — the whole point of the pool is a constant light count.
  for (const g of L.sigils) g.light.intensity = 0;
  scene.remove(L.grp);
  if (L.blobs) for (const b of L.blobs) { scene.remove(b); b.geometry.dispose(); b.material.dispose(); }
  if (L.blobTex) L.blobTex.dispose();
  L.grp.traverse(o => {
    if (o.geometry && !o.isSprite) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k in m) {
        const v = m[k];
        if (v && v.isTexture && v !== glowTex && v !== envTex) v.dispose();
      }
      m.dispose();
    }
  });
  if (L.sTex) L.sTex.dispose();
}

// ---------------------------------------------------------------- motion

// Mirrors sect() in DEFORM (minus the ridge term) so sigils sit flush on the hide.
function jsSect(L, u, out) {
  const r = (0.60 + 0.46 * smooth(u, 0, 0.11)) * Math.pow(Math.max(1 - u, 0), 0.78)
    * (1 - 0.82 * smooth(u, 0.76, 1)) * L.size;
  return out.set(r * (1.14 + 0.24 * u), r * (0.74 - 0.26 * u) * L.Z.wide, 0);
}

const pt = (L, i) => (i <= 0 ? L.head : L.spine[i - 1]);

// ---------------------------------------------------------------------------
// CPU body surface. The GPU path fed the same spine texture to the vertex shader,
// but produced degenerate geometry that clipped into a screen-filling wall; this
// evaluates the identical surface on the CPU, which is ~170 frame solves a frame.
// Mirrors the GLSL bodyR/sect/surf — keep the two in sync.
// ---------------------------------------------------------------------------
const _cp = V3(), _cn = V3(), _cb = V3(), _e1 = V3(), _e2 = V3(), _nrm = V3();
// updateLeviathan steering scratch — dedicated (not the _a/_b pool above) because
// updateSpine/placeSigil run mid-stretch and must never alias these.
const _lt = V3(), _ld = V3(), _lc = V3(), _lpu = V3();

function bodyRJs(u) {
  return (0.60 + 0.46 * smooth(u, 0, 0.11)) * Math.pow(Math.max(1 - u, 0), 0.78)
    * (1 - 0.82 * smooth(u, 0.76, 1));
}

// Catmull-Rom centreline + interpolated dorsal/lateral frames at parameter u.
function frameAt(L, u) {
  const NP = L.spine.length + 1;
  const s = u * (NP - 1);
  let i = Math.floor(s);
  const f = s - i;
  const cl = k => pt(L, k < 0 ? 0 : k > NP - 1 ? NP - 1 : k);
  const p0 = cl(i - 1), p1 = cl(i), p2 = cl(i + 1), p3 = cl(i + 2);
  const ff = f * f, fff = ff * f;
  _cp.set(
    0.5 * (2 * p1.x + (p2.x - p0.x) * f + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * ff + (3 * p1.x - p0.x - 3 * p2.x + p3.x) * fff),
    0.5 * (2 * p1.y + (p2.y - p0.y) * f + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * ff + (3 * p1.y - p0.y - 3 * p2.y + p3.y) * fff),
    0.5 * (2 * p1.z + (p2.z - p0.z) * f + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * ff + (3 * p1.z - p0.z - 3 * p2.z + p3.z) * fff)
  );
  const a = i < 0 ? 0 : i > NP - 1 ? NP - 1 : i;
  const b = a + 1 > NP - 1 ? NP - 1 : a + 1;
  _cn.copy(L.fN[a]).lerp(L.fN[b], f);
  if (_cn.lengthSq() < 1e-9) _cn.set(0, 1, 0); else _cn.normalize();
  _cb.copy(L.fB[a]).lerp(L.fB[b], f);
  if (_cb.lengthSq() < 1e-9) _cb.set(1, 0, 0); else _cb.normalize();
}

// Rebuilds the body tube's positions and normals from the current spine.
function rebuildBody(L) {
  const geo = L.bodyGeo;
  if (!geo) return;
  const { rings, radial } = geo.userData;
  const pos = geo.attributes.position.array;
  const nor = geo.attributes.normal.array;
  const NP = L.spine.length + 1;
  const row = radial + 1;

  for (let i = 0; i <= rings; i++) {
    const u = i / rings;
    frameAt(L, u);
    const r = bodyRJs(u) * L.size;
    const rid = 1 + 0.009 * Math.sin(u * (NP - 1) * 6.2831853) + 0.006 * Math.sin(u * 81);
    const hh = r * (1.14 + 0.24 * u) * rid;
    const ww = r * (0.74 - 0.26 * u) * L.Z.wide * rid;
    const px = _cp.x, py = _cp.y, pz = _cp.z;
    const nx = _cn.x, ny = _cn.y, nz = _cn.z;
    const bx = _cb.x, by = _cb.y, bz = _cb.z;
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * 6.2831853;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const vent = ca < 0 ? -ca : 0;
      const h = hh * (1 - 0.20 * vent * vent);
      const w = ww * (1 + 0.13 * vent) * (1 + 0.05 * Math.sin(ang * 7));
      const k = (i * row + j) * 3;
      pos[k] = px + nx * ca * h + bx * sa * w;
      pos[k + 1] = py + ny * ca * h + by * sa * w;
      pos[k + 2] = pz + nz * ca * h + bz * sa * w;
    }
  }

  // Normals from the finished grid: cheaper and steadier than re-solving the surface.
  for (let i = 0; i <= rings; i++) {
    const iN = i < rings ? i + 1 : i, iP = i > 0 ? i - 1 : i;
    for (let j = 0; j <= radial; j++) {
      const jN = j < radial ? j + 1 : 1, jP = j > 0 ? j - 1 : radial - 1;
      const k = (i * row + j) * 3;
      const kU = (iN * row + j) * 3, kD = (iP * row + j) * 3;
      const kR = (i * row + jN) * 3, kL = (i * row + jP) * 3;
      _e1.set(pos[kU] - pos[kD], pos[kU + 1] - pos[kD + 1], pos[kU + 2] - pos[kD + 2]);
      _e2.set(pos[kR] - pos[kL], pos[kR + 1] - pos[kL + 1], pos[kR + 2] - pos[kL + 2]);
      _nrm.crossVectors(_e2, _e1);
      if (_nrm.lengthSq() < 1e-12) _nrm.set(0, 1, 0); else _nrm.normalize();
      nor[k] = _nrm.x; nor[k + 1] = _nrm.y; nor[k + 2] = _nrm.z;
    }
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.normal.needsUpdate = true;
}

// Rebuilds rotation-minimising frames from a centreline and banks them by `roll`.
function buildFrames(L, src, roll) {
  const n = L.spine.length;
  for (let i = 0; i <= n; i++) {
    _t.subVectors(src(Math.min(n, i + 1)), src(Math.max(0, i - 1)));
    if (_t.lengthSq() < 1e-9) _t.copy(L.fT[i]); else _t.normalize();
    _b.crossVectors(_t, Math.abs(_t.y) > 0.93 ? L.fN[i] : UP);
    if (_b.lengthSq() < 1e-8) _b.crossVectors(_t, L.fB[i]);
    _b.normalize();
    _n.crossVectors(_b, _t).normalize();
    const rl = roll * (1 - 0.35 * i / n) + 0.13 * Math.sin(L.wave - i * 0.55 + 1.3);
    const cs = Math.cos(rl), sn = Math.sin(rl);
    L.fT[i].copy(_t);
    L.fN[i].set(_n.x * cs + _b.x * sn, _n.y * cs + _b.y * sn, _n.z * cs + _b.z * sn);
    L.fB[i].set(_b.x * cs - _n.x * sn, _b.y * cs - _n.y * sn, _b.z * cs - _n.z * sn);
  }
}

function uploadSpine(L) {
  const n = L.spine.length, NP = n + 1, D = L.sData;
  for (let i = 0; i < NP; i++) {
    const p = pt(L, i), N = L.fN[i], B = L.fB[i];
    let o = i * 4;
    D[o] = p.x; D[o + 1] = p.y; D[o + 2] = p.z;
    o = (NP + i) * 4;
    D[o] = N.x; D[o + 1] = N.y; D[o + 2] = N.z;
    o = (2 * NP + i) * 4;
    D[o] = B.x; D[o + 1] = B.y; D[o + 2] = B.z;
  }
  L.sTex.needsUpdate = true;   // fins/thorns still read the spine on the GPU
  rebuildBody(L);              // the body surface itself is solved on the CPU
}

// Anchor chain -> lateral travelling wave -> final frames -> GPU.
function updateSpine(L) {
  const n = L.spine.length, gap = L.gap;
  let prev = L.head;
  for (let i = 0; i < n; i++) {
    const s = L.anchor[i];
    _a.subVectors(s, prev);
    const d = _a.length() || 1;
    s.copy(prev).addScaledVector(_a.divideScalar(d), gap);      // exact spacing: pulls and pushes
    prev = s;
  }
  // frames from the un-waved path give a stable lateral axis for the wave
  buildFrames(L, i => (i <= 0 ? L.head : L.anchor[i - 1]), 0);
  const k = 0.52 + L.agitation * 0.12;
  const amp = (1 + L.agitation * 0.85 + L.lunge * 0.5) * L.swim;
  for (let i = 0; i < n; i++) {
    const u = (i + 1) / n;
    const off = Math.sin(L.wave - (i + 1) * k) * L.size * (0.05 + 1.30 * u * u) * amp;
    L.spine[i].copy(L.anchor[i]).addScaledVector(L.fB[i + 1], off);
    L.spine[i].y += Math.sin(L.wave * 0.53 - i * 0.31) * L.size * 0.05 * L.swim;
  }
  buildFrames(L, i => pt(L, i), L.roll);
  uploadSpine(L);
}

// Distance from p to the segment a->b: a swept touch test, so a frame hitch or a
// fast swim-by can never tunnel the player straight through a sigil.
function segDist(p, a, b) {
  _b.subVectors(b, a);
  const l2 = _b.lengthSq();
  if (l2 < 1e-8) return p.distanceTo(a);
  const s = clamp(((p.x - a.x) * _b.x + (p.y - a.y) * _b.y + (p.z - a.z) * _b.z) / l2, 0, 1);
  return Math.hypot(a.x + _b.x * s - p.x, a.y + _b.y * s - p.y, a.z + _b.z * s - p.z);
}

// Seats a ward flush on the hide, oriented with the local surface frame.
function placeSigil(L, g) {
  const i = g.seg + 1, hw = jsSect(L, i / L.spine.length, _p);
  const s = L.spine[g.seg], N = L.fN[i], B = L.fB[i], T = L.fT[i];
  const ca = Math.cos(g.ang) * hw.x, sa = Math.sin(g.ang) * hw.y;
  _a.set(N.x * ca + B.x * sa, N.y * ca + B.y * sa, N.z * ca + B.z * sa);
  g.grp.position.copy(s).add(_a);
  g.light.position.copy(g.grp.position);
  g.halo.position.copy(g.grp.position);
  _n.copy(_a).normalize();
  _b.crossVectors(T, _n).normalize();
  _t.crossVectors(_n, _b).normalize();
  g.grp.quaternion.setFromRotationMatrix(_m.makeBasis(_b, _t, _n));
}

// One ember burst from a freshly lit ward. Ring buffer, so a burst never allocates.
function burstEmbers(L, at, n = 40) {
  const E = L.em;
  for (let k = 0; k < n; k++) {
    const i = E.head; E.head = (E.head + 1) % E.cap;
    if (E.life[i] <= 0) E.alive++;
    const o = i * 3;
    E.pos[o] = at.x; E.pos[o + 1] = at.y; E.pos[o + 2] = at.z;
    const th = Math.random() * 6.2832, ph = Math.acos(1 - 2 * Math.random());
    const sp = L.size * (1.1 + Math.random() * 3.0);
    E.vel[o] = Math.sin(ph) * Math.cos(th) * sp;
    E.vel[o + 1] = Math.cos(ph) * sp * 0.6;
    E.vel[o + 2] = Math.sin(ph) * Math.sin(th) * sp;
    E.life[i] = 1;
    E.sz[i] = 0.45 + Math.random() * 1.05;
  }
  L.embers.visible = true;
}

function updateEmbers(L, dt) {
  const E = L.em;
  if (!E.alive) { L.embers.visible = false; return; }
  const dr = Math.pow(0.26, dt), rise = L.size * 1.1 * dt;
  let alive = 0;
  for (let i = 0; i < E.cap; i++) {
    if (E.life[i] <= 0) continue;
    E.life[i] -= dt * 0.42;                                   // ~2.4s tails
    if (E.life[i] <= 0) { E.life[i] = 0; continue; }
    alive++;
    const o = i * 3;
    E.vel[o] *= dr; E.vel[o + 1] = E.vel[o + 1] * dr + rise; E.vel[o + 2] *= dr;
    E.pos[o] += E.vel[o] * dt;
    E.pos[o + 1] += E.vel[o + 1] * dt;
    E.pos[o + 2] += E.vel[o + 2] * dt;
  }
  E.alive = alive;
  L.embers.geometry.attributes.position.needsUpdate = true;
  L.embers.geometry.attributes.aLife.needsUpdate = true;
  L.embers.geometry.attributes.aSize.needsUpdate = true;
}

// Radial shockwave of hide-light from each ward, ~1.5s, plus the shared body flare.
function updateSigilFX(L, dt) {
  const U = L.uni;
  for (let i = 0; i < L.sigils.length; i++) {
    const g = L.sigils[i], fx = U.uSigFX.value[i];
    if (g.flashT >= 1.5) { fx.y = 0; continue; }
    g.flashT += dt;
    const k = Math.min(1, g.flashT / 1.5);
    fx.x = 0.62 * Math.pow(k, 0.65);
    fx.y = 3.4 * (1 - k) * (1 - k) * smooth(k, 0, 0.06);
    // 360 at decay 2.0 replaces 900 at decay 1.8: same close-range read where the
    // flash happens (~2-6u), roughly half the scene-wide splash at 30-50u.
    g.light.intensity += 360 * (1 - k) * (1 - k) * (1 - k);
  }
  L.flare = Math.max(0, L.flare - dt * 0.85);
  U.uFlare.value = L.flare * L.flare;
  updateEmbers(L, dt);
}

// Cheap grounding cue: soft dark blobs on the terrain under the lowest body points.
function updateBlobs(L) {
  const n = L.spine.length, vis = L.grp.visible;
  for (let b = 0; b < L.blobs.length; b++) {
    const m = L.blobs[b];
    if (!vis) { m.visible = false; continue; }
    const s = L.spine[Math.min(n - 1, Math.round((b + 0.5) / L.blobs.length * n))];
    const gy = terrainH(s.x, s.z, L.idx);
    // 40u band, not 12: the head's y is clamped to zoneBottom+55, so the creature never
    // gets closer than ~35u to the open crater floor and a 12u test would never fire.
    const h = s.y - gy - L.size;                 // clearance under the hide, not the centreline
    if (h > 40) { m.visible = false; continue; }
    const k = 1 - Math.max(0, h) / 40;
    const near = 1 - smooth(camera.position.distanceTo(s), 95, 210);
    if (near <= 0) { m.visible = false; continue; }
    m.visible = true;
    m.position.set(s.x, gy + 0.5, s.z);
    m.scale.setScalar(L.size * (2.4 + 2.8 * (1 - k)));
    m.material.opacity = 0.60 * Math.pow(k, 0.55) * near * L.uni.uFade.value;
  }
}

// Returns { sigilLit, calmed, lightDrain, slam, remaining } so the game layer owns audio/UI/scoring.
export function updateLeviathan(L, dt, t, player) {
  const ev = { sigilLit: 0, calmed: false, lightDrain: 0, slam: false, remaining: 0 };
  const n = L.spine.length, U = L.uni;
  if (!L.pPrev) L.pPrev = player.pos.clone();
  L.t += dt;
  L.swim = L.calmed ? Math.max(0.16, 1 - L.calmT * 0.12) : 1;
  L.wave += dt * (1.8 + L.agitation * 2.4 + L.lunge * 2.2) * L.swim;
  U.uTime.value = L.t;
  U.uAgit.value = L.agitation;

  if (!L.calmed) {
    const yTop = zoneTop(L.idx) - 15, yBot = zoneBottom(L.idx) + 55;
    // Zone 0's sleeper idles shallow (62/38 split toward the top of its band) so it
    // regularly crosses the volumetric sun shafts — the silhouette-through-light beat.
    const yMid = L.idx === 0 ? yTop * 0.62 + yBot * 0.38 : (yTop + yBot) / 2;
    // module-scoped temps: this ran 4-5 clone()/V3() per frame while un-calmed
    const target = L.agitation > 0.05
      ? _lt.copy(player.pos)
      : _lt.set(Math.sin(L.t * 0.07) * WORLD_R * 0.6, yMid + Math.sin(L.t * 0.05) * ZONE_H * 0.3, Math.cos(L.t * 0.09) * WORLD_R * 0.6);
    const dir = _ld.copy(target).sub(L.head);
    const d = dir.length() || 1;
    dir.divideScalar(d);
    const cur = _lc.set(Math.cos(L.pitch) * Math.cos(L.ang), Math.sin(L.pitch), Math.cos(L.pitch) * Math.sin(L.ang));
    // Steering fades to zero inside a flyby radius: chasing the player's exact position
    // makes the head overshoot, whip around, and pirouette in a tight orbit. Inside
    // ~3 body-radii it holds course and swims past, then re-approaches.
    const flyby = clamp((d - L.size * 3) / (L.size * 6), 0, 1);
    cur.lerp(dir, Math.min(1, (L.agitation > 0.05 ? 1.4 : 0.5) * flyby * dt)).normalize();
    L.pitch = Math.asin(clamp(cur.y, -1, 1));
    const prevAng = L.ang;
    L.ang = Math.atan2(cur.z, cur.x);

    // bank into the turn: roll trails the yaw rate
    let dA = L.ang - prevAng;
    if (dA > Math.PI) dA -= 6.2832; else if (dA < -Math.PI) dA += 6.2832;
    L.roll = lerp(L.roll, clamp(dA / Math.max(dt, 1e-3) * 0.6, -0.9, 0.9), Math.min(1, 4 * dt));

    // lunge: a committed dash once it has closed on the player
    L.lungeCd -= dt;
    if (L.lunge > 0) L.lunge = Math.max(0, L.lunge - dt * 0.8);
    if (L.lungeCd <= 0 && L.agitation > 0.55 && d < L.size * 22) { L.lunge = 1; L.lungeCd = rng(4, 7); }

    L.head.addScaledVector(cur, L.speed * (1 + L.agitation * 2.2 + L.lunge * 2.6) * dt);
    L.head.y = clamp(L.head.y, yBot, yTop);
    const hr = Math.hypot(L.head.x, L.head.z);
    if (hr > WORLD_R) { L.head.x *= WORLD_R / hr; L.head.z *= WORLD_R / hr; }
    L.agitation = Math.max(0, L.agitation - dt * 0.2);
    L.mouth = lerp(L.mouth, 0.05 + L.agitation * 0.28 + L.lunge * 0.45, Math.min(1, 7 * dt));

    updateSpine(L);

    let near = L.head.distanceTo(player.pos), nearSeg = L.head;
    for (const s of L.spine) {
      const dd = s.distanceTo(player.pos);
      if (dd < near) { near = dd; nearSeg = s; }
    }
    const danger = Math.max(0, 1 - near / (L.size * 6));
    if (danger > 0) {
      ev.lightDrain += danger * dt * (0.10 + 0.05 * L.idx);
      L.agitation = Math.min(1, L.agitation + danger * dt * 1.5);
    }
    if (near < L.size * 1.4) {
      const push = _lpu.copy(player.pos).sub(nearSeg).normalize();
      player.vel.addScaledVector(push, 90 * dt * 8);
      ev.lightDrain += dt * 0.5;
      ev.slam = true;
    }

    let allLit = true;
    for (let i = 0; i < L.sigils.length; i++) {
      const g = L.sigils[i];
      g.pulse += dt;
      placeSigil(L, g);
      if (g.lit) {
        g.rune.material.opacity = 1;
        g.grp.scale.setScalar(L.size * 0.95 * (1 + 0.04 * Math.sin(g.pulse * 3)));
        g.light.intensity = 140 + 40 * Math.sin(g.pulse * 3);
        g.halo.scale.setScalar(L.size * 3);
        U.uSig.value[i].y = 1.6 + 0.35 * Math.sin(g.pulse * 3);
      } else {
        allLit = false;
        g.rune.material.opacity = 0.22 + 0.16 * Math.sin(g.pulse * 2);
        g.light.intensity = 8 + 5 * Math.sin(g.pulse * 2);
        g.halo.scale.setScalar(L.size * 1.2 + Math.sin(g.pulse * 2) * 0.6);
        U.uSig.value[i].y = 0.10 + 0.05 * Math.sin(g.pulse * 2);
        // touch radius is measured from the spine point AND the visible ward
        const reach = L.size * 1.6;
        if (segDist(L.spine[g.seg], L.pPrev, player.pos) < reach
          || segDist(g.grp.position, L.pPrev, player.pos) < reach) {
          g.lit = true;
          g.flashT = 0;
          L.flare = 1;
          burstEmbers(L, g.grp.position);
          ev.sigilLit = 392 + g.seg * 8;
          L.agitation = 1;
        }
      }
    }
    ev.remaining = L.sigils.filter(q => !q.lit).length;
    if (allLit) { L.calmed = true; L.calmT = 0; ev.calmed = true; }
  } else {
    L.calmT += dt;
    L.agitation = 0;
    L.roll *= Math.pow(0.3, dt);
    L.mouth = lerp(L.mouth, 0.02, Math.min(1, 2 * dt));
    L.head.y -= 2 * dt;
    L.head.addScaledVector(_a.set(Math.cos(L.ang), 0, Math.sin(L.ang)), L.speed * 0.25 * L.swim * dt);
    updateSpine(L);
    U.uFade.value = Math.max(0, 1 - L.calmT / 26);
    // one nose-to-tail wave of the ward light, and the stripes easing to calm cyan over 4s
    const wv = Math.min(1, L.calmT / 4);
    U.uWave.value.set(wv * 1.12 - 0.06, Math.sin(Math.PI * wv) * 1.9);
    if (!L.bio0) L.bio0 = U.uBio.value.clone();
    U.uBio.value.copy(L.bio0).lerp(_col.setHex(0x9fe8ff), smooth(wv, 0, 1));
    U.uBioI.value = lerp(L.Z.bioI, L.Z.bioI * 0.55, smooth(wv, 0, 1));
    U.uCrackI.value *= Math.pow(0.25, dt);
    for (let i = 0; i < L.sigils.length; i++) {
      const g = L.sigils[i];
      g.pulse += dt;
      placeSigil(L, g);
      g.light.intensity = Math.max(0, 120 - L.calmT * 8);
      U.uSig.value[i].y = Math.max(0, 1.4 - L.calmT * 0.09);
    }
    for (const e of L.eyes) e.iris.material.color.lerp(_col.setHex(0x66ddff), Math.min(1, dt * 0.8));
    if (L.calmT > 28) L.grp.visible = false;
  }

  // head rig: local +Z is the snout, +Y dorsal, so the basis is (B, N, -T)
  L.headGrp.quaternion.setFromRotationMatrix(_m.makeBasis(L.fB[0], L.fN[0], _a.copy(L.fT[0]).negate()));
  L.headGrp.rotateY(Math.sin(L.wave + 0.6) * 0.07 * L.swim);
  L.headGrp.position.copy(L.head);
  L.jaw.rotation.x = L.mouth;
  L.maw.material.opacity = (0.2 + 0.8 * clamp(L.mouth * 2.4, 0, 1)) * U.uFade.value;
  const pw = Math.sin(L.wave * 0.75) * 0.42;
  for (const p of L.pecs) p.mesh.rotation.set(0.25 + pw * 0.5, p.sx * (1.15 + pw * 0.4), p.sx * 0.5);
  for (const e of L.eyes) e.halo.material.opacity = (0.3 + 0.5 * L.agitation) * U.uFade.value;

  // flank light nodes
  const gp = L.glow.geometry.attributes.position;
  for (let i = 0; i < n; i++) {
    const hw = jsSect(L, (i + 1) / n, _p);
    const s = L.spine[i], N = L.fN[i + 1], B = L.fB[i + 1];
    for (let k = 0; k < 2; k++) {
      const a = (k ? 1 : -1) * 1.15, ca = Math.cos(a) * hw.x, sa = Math.sin(a) * hw.y;
      gp.setXYZ(i * 2 + k, s.x + N.x * ca + B.x * sa, s.y + N.y * ca + B.y * sa, s.z + N.z * ca + B.z * sa);
    }
  }
  gp.needsUpdate = true;
  L.glow.material.opacity = (0.26 + 0.14 * Math.sin(L.t * 1.3) + 0.25 * L.agitation) * U.uFade.value;

  if (L.thorns) {
    for (let i = 0; i < n; i++) {
      const u = (i + 1) / n, hw = jsSect(L, u, _p);
      const s = L.spine[i], N = L.fN[i + 1];
      _a.copy(N).addScaledVector(L.fT[i + 1], 0.45).normalize();
      _b.copy(s).addScaledVector(N, hw.x * 0.88);
      _q.setFromUnitVectors(UP, _a);
      const ln = L.size * (0.25 + 1.05 * Math.pow(Math.sin(u * Math.PI), 0.7)) * (i & 1 ? 0.6 : 1) * (L.Z.thorn === 2 ? 0.8 : 1.15);
      L.thorns.setMatrixAt(i, _m.compose(_b, _q, _sc.set(ln * 0.5, ln, ln * 0.5)));
    }
    L.thorns.instanceMatrix.needsUpdate = true;
  }
  updateSigilFX(L, dt);
  updateBlobs(L);
  L.pPrev.copy(player.pos);
  return ev;
}
