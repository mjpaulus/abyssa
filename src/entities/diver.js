// The Mark V diver: model, materials, and pose animation. OWNED BY: diver/character agent.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, envTex } from '../core.js';
import { SURFACE_Y } from '../config.js';
import { V3, clamp, lerp, rng, fbm } from '../lib/math.js';
import { makeGlow, canvas2d, toTexture, noiseCanvas, normalFromHeight } from '../lib/textures.js';

const TAU = Math.PI * 2;
const ss = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Semi-implicit spring used for every bit of secondary motion (helmet lag, hose sway,
// lantern pendulum). dt is clamped so a stalled frame can't blow the integrator up.
function spring(s, target, dt, freq, damp) {
  const h = Math.min(dt, 0.022), k = freq * freq, c = 2 * damp * freq;
  s.v += (k * (target - s.x) - c * s.v) * h;
  s.x += s.v * h;
  return s.x;
}

// Catmull-Rom over a wrapping [phase, value] key list, so the gait is authored as real
// animation curves (contact / absorb / passing / push-off) instead of stacked sines.
function curve(keys) {
  const n = keys.length;
  return p => {
    p -= Math.floor(p);
    let i = 0;
    while (i < n && keys[i][0] <= p) i++;
    const i1 = (i - 1 + n) % n, i2 = i % n, i0 = (i1 - 1 + n) % n, i3 = (i2 + 1) % n;
    const t0 = keys[i1][0];
    let t1 = keys[i2][0];
    if (t1 <= t0) t1 += 1;
    let d = p - t0; if (d < 0) d += 1;
    const u = d / (t1 - t0);
    const v0 = keys[i0][1], v1 = keys[i1][1], v2 = keys[i2][1], v3 = keys[i3][1];
    return 0.5 * (2 * v1 + (v2 - v0) * u + (2 * v0 - 5 * v1 + 4 * v2 - v3) * u * u + (-v0 + 3 * v1 - 3 * v2 + v3) * u * u * u);
  };
}

// ---- procedural PBR maps ----
// One height field drives albedo, roughness and normal together, so verdigris and wear
// land in the same crevices the normal map actually shows.
function metalMaps(hi, lo, verd, rep, S = 256) {
  const hc = noiseCanvas(S, 5, 1.0);
  const h = hc.getContext('2d');
  for (let i = 0; i < 90; i++) {  // hammer dents
    const x = Math.random() * S, y = Math.random() * S, r = rng(5, 20);
    const gr = h.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, Math.random() < 0.6 ? 'rgba(0,0,0,.34)' : 'rgba(255,255,255,.3)');
    gr.addColorStop(1, 'rgba(128,128,128,0)');
    h.fillStyle = gr; h.beginPath(); h.arc(x, y, r, 0, TAU); h.fill();
  }
  h.lineCap = 'round';
  for (let i = 0; i < 240; i++) {  // hairline scratches
    const x = Math.random() * S, y = Math.random() * S, a = rng(-0.45, 0.45) + (Math.random() < 0.5 ? 0 : 1.57), l = rng(8, 72);
    h.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.24)' : 'rgba(0,0,0,.24)';
    h.lineWidth = rng(0.5, 1.7);
    h.beginPath(); h.moveTo(x, y); h.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); h.stroke();
  }
  const hd = h.getImageData(0, 0, S, S).data;
  const pd = noiseCanvas(S, 2, 1.0).getContext('2d').getImageData(0, 0, S, S).data;  // patchiness
  const { canvas: ac, ctx: a } = canvas2d(S);
  const { canvas: rc, ctx: r } = canvas2d(S);
  const ai = a.createImageData(S, S), ri = r.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = hd[i * 4] / 255, patch = pd[i * 4] / 255;
    const cav = 1 - ss(0.30, 0.56, v);                       // cavity mask
    const green = cav * ss(0.42, 0.78, patch);               // verdigris only in patchy crevices
    let c = mix3(lo, hi, ss(0.34, 0.86, v));
    c = mix3(c, verd, green * 0.8);
    ai.data[i * 4] = c[0]; ai.data[i * 4 + 1] = c[1]; ai.data[i * 4 + 2] = c[2]; ai.data[i * 4 + 3] = 255;
    const rough = clamp(0.16 + 0.52 * cav + 0.30 * green + 0.10 * (1 - v), 0, 1) * 255;
    ri.data[i * 4] = ri.data[i * 4 + 1] = ri.data[i * 4 + 2] = rough; ri.data[i * 4 + 3] = 255;
  }
  a.putImageData(ai, 0, 0); r.putImageData(ri, 0, 0);
  return { map: toTexture(ac, rep, true), rough: toTexture(rc, rep), nrm: toTexture(normalFromHeight(hc, 2.6), rep) };
}

function clothMaps(base, rep, S = 256) {
  const { canvas: hc, ctx: h } = canvas2d(S);
  h.fillStyle = '#808080'; h.fillRect(0, 0, S, S);
  const P = 6;                                               // woven thread pitch
  for (let y = 0; y < S; y += P) for (let x = 0; x < S; x += P) {
    const over = ((x / P) + (y / P)) & 1;
    const g = h.createLinearGradient(x, y, over ? x : x + P, over ? y + P : y);
    g.addColorStop(0, 'rgba(60,60,60,.55)'); g.addColorStop(0.5, 'rgba(215,215,215,.6)'); g.addColorStop(1, 'rgba(60,60,60,.55)');
    h.fillStyle = g; h.fillRect(x, y, P, P);
  }
  for (let i = 0; i < 40; i++) {                             // slubs / thread irregularity
    const y = Math.random() * S;
    h.strokeStyle = `rgba(${Math.random() < 0.5 ? 240 : 40},128,128,.18)`;
    h.lineWidth = rng(1, 3);
    h.beginPath(); h.moveTo(0, y); h.lineTo(S, y + rng(-2, 2)); h.stroke();
  }
  const nd = noiseCanvas(S, 4, 1.2).getContext('2d').getImageData(0, 0, S, S).data;
  const hd = h.getImageData(0, 0, S, S).data;
  const { canvas: ac, ctx: a } = canvas2d(S);
  const { canvas: rc, ctx: r } = canvas2d(S);
  const ai = a.createImageData(S, S), ri = r.createImageData(S, S);
  const grime = [58, 52, 40], salt = [206, 200, 184];
  for (let i = 0; i < S * S; i++) {
    const w = hd[i * 4] / 255, n = nd[i * 4] / 255;
    let c = mix3(base, mix3(base, [255, 255, 255], 0.14), w);
    c = mix3(c, grime, ss(0.55, 0.12, n) * 0.34);            // grime pools in the low-frequency dips
    c = mix3(c, salt, ss(0.88, 0.99, n) * 0.20);             // salt bloom on the high spots
    ai.data[i * 4] = c[0]; ai.data[i * 4 + 1] = c[1]; ai.data[i * 4 + 2] = c[2]; ai.data[i * 4 + 3] = 255;
    const rough = clamp(0.98 - 0.16 * n - 0.08 * w, 0, 1) * 255;
    ri.data[i * 4] = ri.data[i * 4 + 1] = ri.data[i * 4 + 2] = rough; ri.data[i * 4 + 3] = 255;
  }
  a.putImageData(ai, 0, 0); r.putImageData(ri, 0, 0);
  return { map: toTexture(ac, rep, true), rough: toTexture(rc, rep), nrm: toTexture(normalFromHeight(hc, 1.5), rep) };
}

function grainMaps(base, hi, rep, wet, S = 128) {
  const hc = noiseCanvas(S, 5, 1.4);
  const h = hc.getContext('2d');
  for (let i = 0; i < 700; i++) {                            // pebble grain
    const x = Math.random() * S, y = Math.random() * S, r = rng(1, 3.2);
    h.fillStyle = `rgba(${Math.random() < 0.5 ? 30 : 225},128,128,.14)`;
    h.beginPath(); h.arc(x, y, r, 0, TAU); h.fill();
  }
  const hd = h.getImageData(0, 0, S, S).data;
  const { canvas: ac, ctx: a } = canvas2d(S);
  const { canvas: rc, ctx: r } = canvas2d(S);
  const ai = a.createImageData(S, S), ri = r.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = hd[i * 4] / 255;
    const c = mix3(base, hi, ss(0.52, 0.95, v));             // worn/scuffed on the raised grain
    ai.data[i * 4] = c[0]; ai.data[i * 4 + 1] = c[1]; ai.data[i * 4 + 2] = c[2]; ai.data[i * 4 + 3] = 255;
    const rough = clamp(wet - 0.34 * ss(0.45, 0.95, v), 0, 1) * 255;
    ri.data[i * 4] = ri.data[i * 4 + 1] = ri.data[i * 4 + 2] = rough; ri.data[i * 4 + 3] = 255;
  }
  a.putImageData(ai, 0, 0); r.putImageData(ri, 0, 0);
  return { map: toTexture(ac, rep, true), rough: toTexture(rc, rep), nrm: toTexture(normalFromHeight(hc, 2.2), rep) };
}

const copperM = metalMaps([214, 138, 96], [98, 54, 37], [56, 110, 92], 3);
const brassM = metalMaps([232, 196, 108], [112, 88, 38], [84, 114, 76], 4);
const clothM = clothMaps([20, 50, 168], 3);                  // royal blue underlayer
// aged canvas duck: still warm, but pulled off the orange toward a salt-bleached tan-olive
const leatherM = grainMaps([140, 98, 60], [198, 160, 116], 2, 0.62);
const darkLeaM = grainMaps([96, 56, 32], [148, 98, 58], 2, 0.56);
const rubberM = grainMaps([34, 36, 41], [66, 70, 76], 3, 0.74);

const copper = new THREE.MeshStandardMaterial({
  map: copperM.map, roughnessMap: copperM.rough, normalMap: copperM.nrm, normalScale: new THREE.Vector2(0.7, 0.7),
  metalness: 0.94, roughness: 1, envMap: envTex, envMapIntensity: 0.5
});
const brass = new THREE.MeshStandardMaterial({
  map: brassM.map, roughnessMap: brassM.rough, normalMap: brassM.nrm, normalScale: new THREE.Vector2(0.6, 0.6),
  metalness: 0.95, roughness: 1, envMap: envTex, envMapIntensity: 0.62
});
const steel = new THREE.MeshStandardMaterial({ color: 0x3c4046, metalness: 0.78, roughness: 0.6, envMap: envTex, envMapIntensity: 0.2 });
const cloth = new THREE.MeshStandardMaterial({
  map: clothM.map, roughnessMap: clothM.rough, normalMap: clothM.nrm, normalScale: new THREE.Vector2(1.15, 1.15),
  roughness: 1, metalness: 0.02, vertexColors: true, envMap: envTex, envMapIntensity: 0.12
});
const trim = new THREE.MeshStandardMaterial({    // no albedo map: clothM's is blue
  roughnessMap: clothM.rough, normalMap: clothM.nrm, normalScale: new THREE.Vector2(0.9, 0.9), color: 0xe9e3d2,
  roughness: 0.86, metalness: 0.02, envMap: envTex, envMapIntensity: 0.14
});
const leather = new THREE.MeshStandardMaterial({
  map: leatherM.map, roughnessMap: leatherM.rough, normalMap: leatherM.nrm, normalScale: new THREE.Vector2(0.85, 0.85),
  roughness: 1, metalness: 0.04, vertexColors: true, envMap: envTex, envMapIntensity: 0.34
});
const darkLeather = new THREE.MeshStandardMaterial({
  map: darkLeaM.map, roughnessMap: darkLeaM.rough, normalMap: darkLeaM.nrm, normalScale: new THREE.Vector2(0.95, 0.95),
  roughness: 1, metalness: 0.04, vertexColors: true, envMap: envTex, envMapIntensity: 0.28
});
const port = new THREE.MeshStandardMaterial({ color: 0x121519, metalness: 0.55, roughness: 0.42, envMap: envTex, envMapIntensity: 0.3 });
const blueLit = new THREE.MeshStandardMaterial({
  color: 0x0e2c44, emissive: 0x4db8ff, emissiveIntensity: 2.4, roughness: 0.3, metalness: 0.1,
  envMap: envTex, envMapIntensity: 0.3
});
const rubber = new THREE.MeshStandardMaterial({
  map: rubberM.map, roughnessMap: rubberM.rough, normalMap: rubberM.nrm, normalScale: new THREE.Vector2(0.8, 0.8),
  roughness: 1, metalness: 0.06, envMap: envTex, envMapIntensity: 0.16
});
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x1d5c46, metalness: 0.15, roughness: 0.06, emissive: 0x0b2a1d, clearcoat: 1, clearcoatRoughness: 0.05,
  envMap: envTex, envMapIntensity: 1.1, side: THREE.DoubleSide
});
const lantGlass = new THREE.MeshPhysicalMaterial({
  color: 0xffe6bb, metalness: 0, roughness: 0.08, transparent: true, opacity: 0.28,
  emissive: 0xffca7a, emissiveIntensity: 0.5, side: THREE.DoubleSide, depthWrite: false,
  envMap: envTex, envMapIntensity: 0.8
});
// the blade's water-drag streak: additive, opacity animated by the slash clock
const dragMat = new THREE.MeshBasicMaterial({
  color: 0x9fd8f0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
  depthWrite: false, side: THREE.DoubleSide
});
const flameMat = new THREE.MeshBasicMaterial({ color: 0xffd489, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });

// ---- geometry helpers ----
const _o = new THREE.Object3D();
function xf(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  _o.position.set(x, y, z); _o.rotation.set(rx, ry, rz); _o.scale.setScalar(1); _o.updateMatrix();
  return geo.applyMatrix4(_o.matrix);
}
const lathe = (pts, seg = 26) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg);

// Bucket primitives by material and emit one merged mesh each: hundreds of rivets,
// grille bars and studs stay at a handful of draw calls.
function Part(node) {
  const b = new Map();
  return {
    node,
    add(geo, mat) { let a = b.get(mat); if (!a) b.set(mat, a = []); a.push(geo); return geo; },
    bake(shadow = true) {
      for (const [mat, list] of b) {
        // merging demands identical attribute sets; pad plain primitives mixed with folded cloth
        if (mat.vertexColors || list.some(g => g.attributes.color)) for (const g of list) if (!g.attributes.color)
          g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
        const m = new THREE.Mesh(list.length > 1 ? mergeGeometries(list) : list[0], mat);
        m.castShadow = shadow; m.receiveShadow = true;
        node.add(m);
      }
      b.clear();
      return node;
    }
  };
}

// Displace cloth along its normals and bake grime into vertex colours, so dirt genuinely
// pools in the creases the geometry has rather than in an unrelated texture.
// `mask` (optional) scales the displacement per vertex. It exists for solids of
// revolution: at a lathe's POLE every column's vertex is coincident but carries a
// DIFFERENT normal, so one shared displacement fans them out into a starburst of bright
// slivers — visible as a white spray at the crotch, elbows and ankles, exactly where the
// limb caps sit. Masking the amplitude to zero near the axis removes the cause.
function fold(geo, amp, freq, tone = 1, mask = null) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, n = pos.count;
  const col = new Float32Array(n * 3);
  // WELD THE DISPLACEMENT DIRECTION across coincident vertices before moving anything.
  // A lathe, capsule or sphere POLE is several vertices sharing one position but carrying
  // DIFFERENT normals — one per column of the seam. Push each along its own normal and the
  // pole tears open into a starburst of bright slivers. It showed as a white spray at the
  // crotch (the pelvis capsule's lower pole) and at every limb joint. Averaging first makes
  // every copy of a point move as the single point it actually is. Build-time only.
  const key = i => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const acc = new Map();
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let a = acc.get(k);
    if (!a) acc.set(k, a = [0, 0, 0]);
    a[0] += nrm.getX(i); a[1] += nrm.getY(i); a[2] += nrm.getZ(i);
  }
  for (const a of acc.values()) {
    const L = Math.hypot(a[0], a[1], a[2]) || 1;
    a[0] /= L; a[1] /= L; a[2] /= L;
  }
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const dir = acc.get(key(i));
    const a = fbm(x * freq + 11, z * freq + 3) - 0.5;
    const b = fbm(y * freq * 1.7 + 5, (x + z) * 0.7 * freq * 1.7 + 9) - 0.5;
    const c = fbm(y * freq * 4.1 + 21, (x - z) * freq * 4.1 + 2) - 0.5;
    const d = (a * 1.1 + b * 0.9 + c * 0.45) * amp * (mask ? mask(x, y, z) : 1);
    pos.setXYZ(i, x + dir[0] * d, y + dir[1] * d, z + dir[2] * d);
    const g = clamp(tone * (0.80 + (d / amp) * 0.24 - clamp(-y * 0.09, 0, 0.16)), 0.34, 1.1);
    col[i * 3] = g; col[i * 3 + 1] = g * 0.98; col[i * 3 + 2] = g * 0.93;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function rivetRing(p, mat, n, r, y, rad = 0.032, zs = 1, phase = 0.5) {
  const g = new THREE.SphereGeometry(rad, 7, 5);
  for (let i = 0; i < n; i++) {
    const a = (i + phase) / n * TAU;
    p.add(xf(g.clone(), Math.cos(a) * r, y, Math.sin(a) * r * zs), mat);
  }
}

function wingnut(p, x, y, z, ry, s = 1) {
  p.add(xf(new THREE.CylinderGeometry(0.028 * s, 0.032 * s, 0.055 * s, 8).rotateX(Math.PI / 2), x, y, z, 0, ry, 0), brass);
  p.add(xf(new THREE.BoxGeometry(0.115 * s, 0.05 * s, 0.017 * s), x, y, z + 0.012 * s, 0, ry, 0), brass);
}

// One arced guard bar bowing out over a porthole, in the port's local frame (+Z outward).
function guardBar(off, rimR, tube) {
  const c = new THREE.CatmullRomCurve3([
    V3(off, -rimR * 0.98, 0.002), V3(off * 1.06, -rimR * 0.55, 0.048), V3(off * 1.09, 0, 0.062),
    V3(off * 1.06, rimR * 0.55, 0.048), V3(off, rimR * 0.98, 0.002)
  ]);
  return new THREE.TubeGeometry(c, 9, tube, 4, false);
}

// A raised trim strip following a lathe profile's front (or back) face — panel/centre seams.
function seamTube(pts, zs, r, sign = 1, xoff = 0, rad = 0.014) {
  const c = new THREE.CatmullRomCurve3(pts.map(pt => V3(xoff, pt[1], sign * (pt[0] * zs + r))));
  return new THREE.TubeGeometry(c, pts.length * 2, rad, 5, false);
}
// Flattened ring band (sock cuffs, thigh straps, gauntlet bands).
const band = (r, h, t = 0.9, seg = 14) => new THREE.CylinderGeometry(r, r, h, seg, 1, true).scale(1, 1, t);

// ---- limb sculpting ----
// A LIMB IS NOT A TUBE. Every segment is a solid of revolution whose radius is keyed
// along its length, so the girth story reads at nine units (the only distance any deck
// detail is ever seen from): deltoid > elbow, forearm belly > wrist, thigh > knee,
// calf > ankle. The suit is canvas OVER that anatomy, so the keys are soft — the twill
// smooths a bicep into a swell — but the swell has to be there or the eye reads pipe.
//
// profOf: piecewise keys [s, radius-multiplier], smoothstepped between, s = 0 at the
// joint above and 1 at the joint below. Smoothstep (not linear) gives flat tangents at
// every key, which is exactly how slack cloth drapes over a taper.
function profOf(keys) {
  return s => {
    let i = 1;
    while (i < keys.length - 1 && keys[i][0] < s) i++;
    const [s0, k0] = keys[i - 1], [s1, k1] = keys[i];
    const u = clamp((s - s0) / (s1 - s0), 0, 1);
    return k0 + (k1 - k0) * (u * u * (3 - 2 * u));
  };
}

// Lathe a profiled segment of length `len`, hung from y = 0 down to y = -len, with
// rounded caps at both ends so consecutive segments read continuous through a bend
// instead of showing a hard disc at the joint.
function segGeo(len, r, prof, seg = 16, rings = 13) {
  const pts = [];
  const rT = r * prof(0), rB = r * prof(1);
  for (let k = 0; k <= 3; k++) {                             // bottom cap, pole first
    const a = (k / 4) * (Math.PI / 2);
    pts.push([rB * Math.sin(a), -len - rB * 0.62 * Math.cos(a)]);
  }
  for (let i = rings; i >= 0; i--) pts.push([r * prof(i / rings), -len * (i / rings)]);
  for (let k = 3; k >= 0; k--) {                             // top cap, back to the pole
    const a = (k / 4) * (Math.PI / 2);
    pts.push([rT * Math.sin(a), rT * 0.45 * Math.cos(a)]);
  }
  return lathe(pts, seg);
}

// Flat vertex tint. fold() is the wrong tool on a small torus — its displacement is
// per-vertex noise, and on a 5-segment ring that reads as spikes rather than slack. This
// just darkens the gather so grime pools where cloth doubles over, and keeps the geometry
// smooth. Also supplies the `color` attribute the merge needs in a vertexColors bucket.
function tint(geo, g) {
  const n = geo.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = g; c[i * 3 + 1] = g * 0.98; c[i * 3 + 2] = g * 0.93; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

// Canvas has nowhere to go when a joint folds, so it GATHERS: a few soft rings of slack
// stacked where the elbow, knee and groin crease. These sit only just proud of the limb
// surface — a ring standing 20% of the radius off the leg is a hose, not a suit — and are
// tinted down so the crease reads as shadow first and silhouette second.
function bunch(p, mat, r, y, n = 3, dy = 0.052, tube = 0.019, zs = 0.95) {
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const k = 1 - Math.abs(i - mid) / n;
    const g = new THREE.TorusGeometry(r * 0.985, tube * (0.7 + 0.6 * k), 6, 16)
      .rotateX(Math.PI / 2).scale(1, 1, zs);
    p.add(tint(xf(g, 0, y + (i - mid) * dy), 0.80), mat);
  }
}

// Raised piping down a segment's seam, riding the profile so it swells with the limb.
// A tube of 4 radial segments: ~110 tris buys the single line that says "this was sewn".
function piping(p, mat, len, r, prof, sx, sz = 0, rad = 0.013, n = 7) {
  const q = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n, rr = r * prof(s) * 0.99;
    q.push(V3(sx * rr, -len * s, sz * rr));
  }
  p.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(q), n * 2, rad, 4, false), mat);
}

// The four segment profiles. Arms r = 0.150, legs r = 0.186.
const P_UPARM = profOf([[0, 1.00], [0.16, 1.17], [0.45, 1.00], [0.80, 0.86], [1, 0.80]]);   // deltoid/bicep -> elbow
const P_FOREARM = profOf([[0, 0.80], [0.22, 0.93], [0.55, 0.80], [0.85, 0.66], [1, 0.60]]); // belly -> hard wrist taper
const P_THIGH = profOf([[0, 1.06], [0.14, 1.14], [0.42, 1.02], [0.78, 0.85], [1, 0.80]]);
const P_SHANK = profOf([[0, 0.80], [0.14, 0.86], [0.30, 0.95], [0.58, 0.80], [0.86, 0.64], [1, 0.60]]); // calf belly -> ankle

// ---- Sal's dive knife ----
// Local frame: the grip's base sits at the origin, the blade runs down -Y. The same
// builder feeds both copies (sheathed on the thigh, held in the fist) so they are
// literally the same object; only the parent transform differs.
function knifeGeo(p) {
  p.add(xf(new THREE.SphereGeometry(0.026, 8, 6).scale(1, 0.78, 1), 0, 0.082), brass);      // pommel
  p.add(xf(new THREE.CylinderGeometry(0.030, 0.030, 0.020, 10), 0, 0.066), brass);          // butt ferrule
  p.add(xf(new THREE.CylinderGeometry(0.0235, 0.0275, 0.132, 10), 0, 0.002), darkLeather);  // wrapped grip
  for (let i = 0; i < 6; i++)                                                               // wrap ridges
    p.add(xf(new THREE.TorusGeometry(0.0272, 0.0044, 4, 10).rotateX(Math.PI / 2), 0, -0.048 + i * 0.021), darkLeather);
  p.add(xf(new THREE.CylinderGeometry(0.0325, 0.0285, 0.026, 10), 0, -0.058), brass);       // bolster
  p.add(xf(new THREE.BoxGeometry(0.108, 0.021, 0.038), 0, -0.077), brass);                  // guard
  for (const sx of [-1, 1]) p.add(xf(new THREE.SphereGeometry(0.0125, 6, 5), sx * 0.050, -0.077), brass);
  p.add(xf(new THREE.BoxGeometry(0.036, 0.030, 0.016), 0, -0.100), steel);                  // ricasso
  // tapered blade: a 4-gon cylinder squashed in Z gives a real diamond cross-section
  p.add(xf(new THREE.CylinderGeometry(0.0295, 0.0255, 0.170, 4).scale(1, 1, 0.34), 0, -0.190), steel);
  p.add(xf(new THREE.CylinderGeometry(0.0255, 0.0012, 0.078, 4).scale(1, 1, 0.34), 0, -0.314), steel);  // spear point
  return p;
}

// Leather scabbard with a brass throat and chape. Throat mouth sits at local y = +0.09,
// so the knife copy parented here at that height rides fully home.
function sheathGeo(p) {
  p.add(xf(new THREE.CylinderGeometry(0.047, 0.033, 0.365, 8).scale(1, 1, 0.60), 0, -0.093), darkLeather);
  p.add(xf(new THREE.BoxGeometry(0.014, 0.350, 0.014), 0.045, -0.093), leather);           // stitched welt
  p.add(xf(new THREE.CylinderGeometry(0.052, 0.050, 0.052, 8).scale(1, 1, 0.62), 0, 0.072), brass);   // throat
  p.add(xf(new THREE.TorusGeometry(0.051, 0.008, 5, 12).rotateX(Math.PI / 2).scale(1, 1, 0.62), 0, 0.096), brass);
  p.add(xf(new THREE.CylinderGeometry(0.035, 0.021, 0.062, 8).scale(1, 1, 0.62), 0, -0.246), brass);  // chape
  p.add(xf(new THREE.SphereGeometry(0.020, 7, 5).scale(1, 0.8, 0.70), 0, -0.276), brass);
  p.add(xf(new THREE.TorusGeometry(0.030, 0.009, 5, 12).rotateY(Math.PI / 2), 0, 0.112, -0.030), darkLeather);   // belt loop
  for (let i = 0; i < 3; i++)                                                              // face rivets
    p.add(xf(new THREE.SphereGeometry(0.010, 6, 5), 0, 0.020 - i * 0.092, 0.027), brass);
  return p;
}

function porthole(p, rimR, glassR, bars, x, y, z, rx, ry, nb = 8) {
  const put = g => xf(g, x, y, z, rx, ry, 0);
  p.add(put(new THREE.CylinderGeometry(rimR, rimR * 1.06, 0.075, 20, 1, true).rotateX(Math.PI / 2)), brass);
  p.add(put(new THREE.TorusGeometry(rimR, rimR * 0.16, 6, 20).translate(0, 0, 0.036)), brass);
  p.add(put(new THREE.TorusGeometry(rimR * 1.22, rimR * 0.1, 5, 20).translate(0, 0, -0.03)), copper);
  p.add(put(new THREE.SphereGeometry(glassR * 1.9, 14, 7, 0, TAU, 0, 0.56).rotateX(Math.PI / 2).translate(0, 0, -glassR * 1.52)), glassMat);
  for (let i = 0; i < nb; i++) {                             // bezel bolts
    const a = i / nb * TAU;
    p.add(put(new THREE.SphereGeometry(rimR * 0.135, 6, 5).translate(Math.cos(a) * rimR * 1.06, Math.sin(a) * rimR * 1.06, 0.042)), brass);
  }
  if (bars) for (let i = -1; i <= 1; i++) p.add(put(guardBar(i * rimR * 0.56, rimR, rimR * 0.085)), brass);
}

// A short corrugated hose length running up its own +Y, baked to one mesh per joint.
function hoseSeg(len, r) {
  const parts = [new THREE.CylinderGeometry(r * 0.86, r * 0.86, len, 9, 1, true).translate(0, len / 2, 0)];
  const n = Math.max(2, Math.round(len / 0.085));
  for (let i = 0; i < n; i++) parts.push(new THREE.TorusGeometry(r * 0.88, r * 0.2, 5, 9).rotateX(Math.PI / 2).translate(0, (i + 0.5) * len / n, 0));
  return mergeGeometries(parts);
}

export const diver = (() => {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body); g.body = body;
  const hips = new THREE.Group(); hips.position.y = -0.10; body.add(hips); g.hips = hips;
  const spine = new THREE.Group(); spine.position.y = 0.20; hips.add(spine); g.spine = spine;
  const neck = new THREE.Group(); neck.position.y = 0.76; spine.add(neck); g.neck = neck;

  // ---- helmet: lathed bonnet with a real Mark V profile ----
  // Parented to its own group so an authored glTF helmet (entities/helmetSwap.js) can
  // replace it wholesale: hide this group, add the loaded model to `neck`.
  const helmGroup = new THREE.Group();
  neck.add(helmGroup);
  g.helmGroup = helmGroup;
  {
    const p = Part(helmGroup);
    p.add(lathe([
      [0.000, 0.000], [0.246, 0.000], [0.256, 0.045], [0.262, 0.085], [0.300, 0.115], [0.352, 0.165],
      [0.400, 0.235], [0.430, 0.315], [0.444, 0.400], [0.448, 0.480], [0.440, 0.560], [0.418, 0.635],
      [0.382, 0.705], [0.330, 0.775], [0.262, 0.838], [0.176, 0.892], [0.086, 0.936], [0.000, 0.952]
    ], 28), copper);
    // neck ring / breastplate lock
    p.add(xf(new THREE.CylinderGeometry(0.268, 0.276, 0.09, 24), 0, 0.035), brass);
    p.add(xf(new THREE.TorusGeometry(0.272, 0.028, 6, 24).rotateX(Math.PI / 2), 0, 0.082), brass);
    rivetRing(p, brass, 12, 0.286, 0.036, 0.024);
    for (let i = 0; i < 4; i++) {                            // interrupted-thread lugs
      const a = i / 4 * TAU + 0.4;
      p.add(xf(new THREE.BoxGeometry(0.10, 0.036, 0.05), Math.cos(a) * 0.29, 0.005, Math.sin(a) * 0.29, 0, -a, 0), brass);
    }
    porthole(p, 0.198, 0.160, false, 0, 0.455, 0.402, -0.08, 0, 12);    // open front faceplate, 12-bolt bezel
    porthole(p, 0.132, 0.104, true, 0.376, 0.470, 0.128, 0, 1.245);     // side ports
    porthole(p, 0.132, 0.104, true, -0.376, 0.470, 0.128, 0, -1.245);
    porthole(p, 0.126, 0.100, true, 0, 0.818, 0.172, -1.16, 0);         // top port
    for (let i = 0; i < 3; i++) {                            // faceplate dog clamps
      const a = i * 2.094;
      wingnut(p, Math.sin(a) * 0.300, 0.455 + Math.cos(a) * 0.300, 0.300, 0, 0.85);
    }
    // The bonnet is RAISED COPPER — beaten up out of sheet over a former and spun true —
    // and spinning leaves ridges. Five rings sitting exactly on the lathe profile give the
    // dome a scale and a set of specular lines it otherwise has no way to earn.
    for (const [rr, yy] of [[0.402, 0.235], [0.446, 0.400], [0.442, 0.520], [0.420, 0.635], [0.334, 0.775]])
      p.add(xf(new THREE.TorusGeometry(rr, 0.0085, 5, 22).rotateX(Math.PI / 2), 0, yy), copper);
    // four wing-nut dogs round the neck ring, clamping the bonnet down onto the corselet.
    // ry = PI/2 - a points each nut's shaft radially outward from the ring.
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * TAU + 0.785;
      wingnut(p, Math.cos(a) * 0.302, 0.068, Math.sin(a) * 0.302, Math.PI / 2 - a, 0.9);
    }
    // brass crest strip, front faceplate to top port
    p.add(xf(new THREE.TorusGeometry(0.40, 0.019, 5, 20, 1.15).rotateZ(0.42).rotateY(Math.PI / 2), 0, 0.455, 0), brass);
    // exhaust valve, right of the faceplate — bubbles vent here
    const ex = new THREE.Group(); ex.position.set(-0.352, 0.315, 0.245); neck.add(ex); g.exhaust = ex;
    p.add(xf(new THREE.CylinderGeometry(0.055, 0.062, 0.07, 10).rotateZ(Math.PI / 2), -0.375, 0.315, 0.245), brass);
    p.add(xf(new THREE.CylinderGeometry(0.036, 0.036, 0.05, 8).rotateZ(Math.PI / 2), -0.425, 0.315, 0.245), copper);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU;
      p.add(xf(new THREE.BoxGeometry(0.05, 0.016, 0.016), -0.425, 0.315 + Math.cos(a) * 0.036, 0.245 + Math.sin(a) * 0.036, a, 0, 0), brass);
    }
    // air inlet elbow (back right) and comms gland (back left)
    p.add(xf(new THREE.CylinderGeometry(0.072, 0.082, 0.12, 10).rotateZ(-0.7), -0.30, 0.40, -0.28, 0, -0.6, 0), brass);
    p.add(xf(new THREE.CylinderGeometry(0.05, 0.056, 0.10, 8).rotateZ(0.5), 0.28, 0.30, -0.30, 0, 0.6, 0), brass);
    p.add(xf(new THREE.SphereGeometry(0.042, 8, 6), 0.30, 0.365, -0.325), copper);
    rivetRing(p, brass, 16, 0.436, 0.24, 0.021);
    p.bake();
  }

  // ---- leather breastplate over the blue-fabric torso ----
  const BP = [
    [0.392, 0.055], [0.414, 0.092], [0.432, 0.158], [0.462, 0.240], [0.524, 0.328], [0.588, 0.424], [0.612, 0.500],
    [0.594, 0.578], [0.530, 0.648], [0.420, 0.706], [0.322, 0.746], [0.276, 0.772], [0.274, 0.816]
  ];
  {
    const p = Part(spine);
    const ZS = 0.78;
    // body-space y minus the spine origin (0.10)
    const shell = lathe(BP, 26);
    shell.scale(0.93, 1, ZS);
    p.add(shell, leather);
    p.add(seamTube(BP.slice(0, 12), ZS * 0.93, 0.010), darkLeather);            // centre seam, front
    p.add(seamTube(BP.slice(0, 12), ZS * 0.93, 0.010, -1), darkLeather);        // spine seam, back
    p.add(xf(new THREE.TorusGeometry(0.278, 0.026, 6, 22).rotateX(Math.PI / 2), 0, 0.804), brass);
    p.add(xf(new THREE.TorusGeometry(0.394, 0.024, 6, 26).rotateX(Math.PI / 2), 0, 0.062).scale(0.93, 1, ZS), darkLeather);
    rivetRing(p, brass, 12, 0.284, 0.780, 0.020);
    // BRAILLES: the studs round the corselet's skirt that the dress is bolted down to
    // through its rubber gasket. On a real Mark V they are the whole reason the suit is
    // watertight, and they are the corselet's most recognisable read at distance.
    rivetRing(p, brass, 14, 0.404, 0.078, 0.023, ZS * 0.93);
    for (const sx of [-0.205, 0.205]) {                      // circular chest vent bosses
      p.add(xf(new THREE.CylinderGeometry(0.080, 0.090, 0.07, 14).rotateX(Math.PI / 2), sx, 0.424, 0.418), copper);
      p.add(xf(new THREE.TorusGeometry(0.076, 0.015, 5, 14), sx, 0.424, 0.452), brass);
      p.add(xf(new THREE.CylinderGeometry(0.060, 0.060, 0.03, 12).rotateX(Math.PI / 2), sx, 0.424, 0.452), port);
      for (let i = 0; i < 3; i++)                            // louvre slats in the port
        p.add(xf(new THREE.BoxGeometry(0.102, 0.012, 0.014), sx, 0.424 + (i - 1) * 0.026, 0.464), steel);
    }
    // Blue fabric torso: slightly broader in x than the carapace so it reads at the sides.
    // The dress is AIR-FILLED, so the belly and flank balloon out below the corselet while
    // the twill pulls tauter across the shoulders where the breastplate pins it down.
    const t = lathe([[0.000, -0.16], [0.336, -0.17], [0.398, -0.06], [0.464, 0.10], [0.536, 0.30], [0.582, 0.470], [0.556, 0.560], [0.000, 0.572]], 22);
    t.scale(1, 1, 0.66);
    p.add(fold(t, 0.030, 7.5, 0.74), cloth);
    p.bake();
  }

  // ---- pelvis, wide leather belt, pouches ----
  {
    const p = Part(hips);
    const pel = new THREE.CapsuleGeometry(0.338, 0.16, 6, 18);
    pel.scale(1, 1, 0.86);
    p.add(fold(xf(pel, 0, 0.02, 0), 0.034, 8, 0.74), cloth);
    // the dress sags at the seat, where the air in the suit can't reach and the canvas
    // just hangs on the man — the one place the silhouette should NOT be a smooth sweep
    const seat = new THREE.SphereGeometry(0.20, 12, 9);
    seat.scale(1.34, 0.80, 0.86);
    p.add(fold(xf(seat, 0, -0.140, -0.140), 0.024, 9, 0.70), cloth);
    const trunk = new THREE.CapsuleGeometry(0.348, 0.13, 6, 18);       // leather trunks over the blue
    trunk.scale(1, 1, 0.86);
    p.add(xf(trunk, 0, -0.10, 0), leather);
    p.add(xf(band(0.368, 0.20, 0.90, 24), 0, 0.03), leather);          // wide belt
    for (const yy of [-0.062, 0.122]) p.add(xf(new THREE.TorusGeometry(0.372, 0.017, 5, 24).rotateX(Math.PI / 2), 0, 0.03 + yy).scale(1, 1, 0.90), darkLeather);
    p.add(xf(new THREE.BoxGeometry(0.235, 0.175, 0.032), 0, 0.03, 0.348), brass);   // rectangular buckle
    p.add(xf(new THREE.BoxGeometry(0.145, 0.09, 0.045), 0, 0.03, 0.352), leather);
    for (const sx of [-1, 1]) {                              // hip D-rings on the belt
      p.add(xf(new THREE.TorusGeometry(0.042, 0.012, 5, 12), sx * 0.318, -0.02, 0.13, 0, sx * 1.1, 0), brass);
    }
    p.bake();
  }

  // ---- backpack shoulder straps + white trim flashes, lying on the carapace ----
  {
    const p = Part(spine);
    for (const sx of [-1, 1]) {
      p.add(xf(new THREE.BoxGeometry(0.072, 0.34, 0.022), sx * 0.20, 0.50, 0.425, 0.10, 0, sx * 0.05), darkLeather);
      p.add(xf(new THREE.BoxGeometry(0.088, 0.055, 0.02), sx * 0.20, 0.375, 0.436, 0.10, 0, sx * 0.05), brass);
    }
    p.bake();
  }

  // ---- backpack apparatus: tank, bottle, regulator box, one blue tell-tale ----
  {
    const pk = new THREE.Group(); pk.position.set(0, 0.40, -0.435); spine.add(pk);
    g.pack = pk;
    const p = Part(pk);
    p.add(xf(new THREE.BoxGeometry(0.46, 0.60, 0.07), 0, 0.02, 0.075), darkLeather);      // back plate
    const tank = new THREE.CapsuleGeometry(0.148, 0.34, 6, 16);
    p.add(xf(tank, -0.03, 0.01, -0.10), steel);
    for (const yy of [-0.13, 0.15]) p.add(xf(new THREE.TorusGeometry(0.152, 0.020, 5, 16).rotateX(Math.PI / 2), -0.03, yy, -0.10), brass);
    p.add(xf(new THREE.CylinderGeometry(0.05, 0.058, 0.07, 10), -0.03, 0.235, -0.10), brass);
    p.add(xf(new THREE.CapsuleGeometry(0.072, 0.20, 5, 12), 0.215, -0.03, -0.045), copper);  // smaller bottle
    p.add(xf(new THREE.TorusGeometry(0.076, 0.016, 5, 12).rotateX(Math.PI / 2), 0.215, 0.075, -0.045), brass);
    p.add(xf(new THREE.BoxGeometry(0.30, 0.17, 0.16), -0.02, 0.30, -0.02), steel);          // regulator box
    p.add(xf(new THREE.BoxGeometry(0.32, 0.035, 0.175), -0.02, 0.375, -0.02), darkLeather);
    for (const sx of [-1, 1]) p.add(xf(new THREE.BoxGeometry(0.055, 0.62, 0.02), sx * 0.20, 0.02, 0.115), darkLeather);
    // the one glowing element: blue lens ring on the regulator's upper corner
    p.add(xf(new THREE.TorusGeometry(0.054, 0.015, 6, 16), 0.195, 0.352, -0.158), brass);
    p.add(xf(new THREE.CylinderGeometry(0.047, 0.047, 0.06, 16).rotateX(Math.PI / 2), 0.195, 0.352, -0.146), blueLit);
    p.bake();
    const gl = makeGlow(0x7fd0ff, 0.46);
    gl.position.set(0.195, 0.352, -0.196);
    gl.material.opacity = 0.55;
    pk.add(gl);
    // hose attachment point: shoulder/top of the main tank, where the feed hose rises off
    const hoseInlet = new THREE.Group();
    hoseInlet.position.set(-0.03, 0.33, -0.15);
    pk.add(hoseInlet);
    g.hoseInlet = hoseInlet;
  }

  // ---- corrugated feed hose: backpack regulator up to the helmet inlet ----
  {
    const p = Part(spine);
    const c = new THREE.CatmullRomCurve3([
      V3(-0.155, 0.755, -0.445), V3(-0.235, 0.885, -0.415), V3(-0.305, 1.045, -0.355), V3(-0.300, 1.160, -0.290)
    ]);
    p.add(new THREE.TubeGeometry(c, 14, 0.056, 8, false), rubber);
    for (let i = 0; i <= 11; i++) {
      const q = c.getPoint(i / 11), tan = c.getTangent(i / 11);
      _o.position.copy(q); _o.lookAt(q.clone().add(tan)); _o.scale.setScalar(1); _o.updateMatrix();
      p.add(new THREE.TorusGeometry(0.058, 0.015, 5, 10).applyMatrix4(_o.matrix), rubber);
    }
    p.bake();
  }

  // ---- limbs ----
  // Joint hierarchy is CONTRACT: root (shoulder/hip) -> mid (elbow/knee) -> end
  // (wrist/ankle), with mid at -upLen and end at -loLen. The gait poses exactly these
  // three groups; only the skin hung on them changes here.
  function limb(parent, x, y, upLen, loLen, r, taper, inward, upProf, loProf) {   // inward 0 = no fabric gusset
    const root = new THREE.Group(); root.position.set(x, y, 0); parent.add(root);
    const mid = new THREE.Group(); mid.position.y = -upLen; root.add(mid);
    const end = new THREE.Group(); end.position.y = -loLen; mid.add(end);
    const pu = Part(root), pl = Part(mid);
    // capMask fences the fold into the segment's BODY (y in [-len, 0]) and fades it out
    // over the last 55mm at each end, so the rounded caps — whose poles starburst under
    // displacement, see fold() — are left perfectly smooth. Nothing is lost: both caps sit
    // buried inside the neighbouring segment and its gather rings.
    const capMask = len => (_x, y) => ss(0, 0.055, -y) * ss(0, 0.055, y + len);
    pu.add(fold(segGeo(upLen, r, upProf), 0.024, 11, 1, capMask(upLen)), leather);
    pl.add(fold(segGeo(loLen, r, loProf), 0.021, 12, 1, capMask(loLen)), leather);
    // blue fabric underlayer: a gusset down the inner limb and a ring at the joint
    if (inward) {
      pu.add(fold(xf(new THREE.CapsuleGeometry(r * 0.42, upLen * 0.44, 5, 10), inward * r * 0.80, -upLen * 0.54, 0), 0.020, 13, 0.74), cloth);
      // clears the sleeve's fold displacement so the band never breaks into patches
      pu.add(xf(band(r * upProf(0.20) * 1.10, 0.06, 0.98, 16), 0, -upLen * 0.20), trim);
    }
    pl.add(fold(xf(new THREE.CapsuleGeometry(r * loProf(0.02) * 1.02, 0.05, 6, 14), 0, 0.015, 0), 0.018, 14, 0.74), cloth);
    return { root, mid, end, pu, pl, r, upLen, loLen, taper, up: upProf, lo: loProf };
  }
  // the diver faces +Z, so his right side is -X
  g.armR = limb(spine, -0.500, 0.615, 0.50, 0.42, 0.150, 0.86, 1, P_UPARM, P_FOREARM);
  g.armL = limb(spine, 0.500, 0.615, 0.50, 0.42, 0.150, 0.86, -1, P_UPARM, P_FOREARM);
  g.legR = limb(hips, -0.225, 0.0, 0.562, 0.465, 0.186, 0.88, 0, P_THIGH, P_SHANK);
  g.legL = limb(hips, 0.225, 0.0, 0.562, 0.465, 0.186, 0.88, 0, P_THIGH, P_SHANK);

  // sleeves: piping down the outer seam, and the canvas bunching at the elbow
  for (const [arm, sx] of [[g.armR, -1], [g.armL, 1]]) {
    const { pu, pl, r, upLen, loLen } = arm;
    // in `leather`, not darkLeather: the sleeve Parts carry no dark bucket, and a second
    // bucket here is a second draw call per arm. A raised ridge in the same canvas still
    // reads as a seam off its own shading — it does not need a contrasting colour.
    piping(pu, leather, upLen, r, P_UPARM, sx, 0, 0.012);
    piping(pl, leather, loLen, r, P_FOREARM, sx, 0, 0.011);
    bunch(pu, leather, r * P_UPARM(0.90), -upLen * 0.90, 2, 0.055, 0.026);
    bunch(pl, leather, r * P_FOREARM(0.10), -loLen * 0.10, 3, 0.050, 0.028);
  }

  // trousers: panel seams, stitched knee pads, thigh + under-knee straps
  for (const leg of [g.legR, g.legL]) {
    const { pu, pl, r, upLen, loLen } = leg;
    const rU = s => r * P_THIGH(s), rL = s => r * P_SHANK(s);   // surface radius at a given s
    // outer and back seam piping, riding the thigh's swell instead of cutting straight down it
    for (const sx of [1, -1]) piping(pu, darkLeather, upLen, r, P_THIGH, sx, 0, 0.013);
    for (const sz of [1, -1]) piping(pu, darkLeather, upLen, r, P_THIGH, 0, sz, 0.011);
    piping(pl, darkLeather, loLen, r, P_SHANK, 1, 0, 0.011);
    piping(pl, darkLeather, loLen, r, P_SHANK, -1, 0, 0.011);
    // the dress gathers into the groin at the top of the thigh, and above the knee
    bunch(pu, leather, rU(0.06), -upLen * 0.06, 3, 0.056, 0.032);
    bunch(pu, leather, rU(0.90), -upLen * 0.90, 2, 0.052, 0.026);
    bunch(pl, leather, rL(0.10), -loLen * 0.10, 3, 0.048, 0.030);
    for (const s of [0.356, 0.712]) {                        // thigh straps with tiny buckles
      const yy = -upLen * s;
      pu.add(xf(band(rU(s) * 1.04, 0.048, 0.95, 14), 0, yy), darkLeather);
      pu.add(xf(new THREE.BoxGeometry(0.06, 0.055, 0.022), 0, yy, rU(s) * 1.02), brass);
    }
    const kz = rL(0.118);                                     // knee pad rides the shank's surface
    const pad = new THREE.SphereGeometry(0.10, 12, 8);        // stitched knee pad, flattened
    pad.scale(1.42, 1.72, 0.40);
    pl.add(xf(pad, 0, -0.055, kz * 0.82), darkLeather);
    for (let i = 0; i < 12; i++) {                           // stitch dots round the pad
      const a = i / 12 * TAU;
      pl.add(xf(new THREE.SphereGeometry(0.011, 5, 4), Math.cos(a) * 0.128, -0.055 + Math.sin(a) * 0.155, kz * 0.88), leather);
    }
    pl.add(xf(band(rL(0.43) * 1.05, 0.042, 0.95, 14), 0, -0.20), darkLeather);
    pl.add(xf(new THREE.BoxGeometry(0.055, 0.05, 0.022), 0, -0.20, rL(0.43) * 1.02), brass);
  }
  for (const l of [g.armR, g.armL, g.legR, g.legL]) { l.pu.bake(); l.pl.bake(); }

  // GAUNTLETS. The forearm now tapers hard into a 0.090 wrist, so the cuff FLARES back
  // out over it — a laced canvas bell, a lace band with brass eyelets, then a mitten with
  // a real knuckle ridge and an opposed thumb. Hands are half of what makes a silhouette
  // read as a man; a rounded stump at the end of a sleeve reads as a mannequin.
  for (const [arm, s] of [[g.armR, -1], [g.armL, 1]]) {
    const p = Part(arm.end);
    // the cuff bell: canvas gathered up off the wrist and laced down
    p.add(fold(lathe([
      [0.090, 0.140], [0.112, 0.110], [0.140, 0.076], [0.152, 0.040], [0.150, 0.012], [0.126, -0.012], [0.114, -0.034]
    ], 16), 0.010, 16, 0.74), cloth);
    p.add(xf(new THREE.TorusGeometry(0.152, 0.016, 5, 16).rotateX(Math.PI / 2), 0, 0.040), trim);   // lace band
    for (let i = 0; i < 6; i++) {                            // lace eyelets
      const a = i / 6 * TAU;
      p.add(xf(new THREE.SphereGeometry(0.013, 5, 4), Math.cos(a) * 0.153, 0.040, Math.sin(a) * 0.153), brass);
    }
    p.add(xf(new THREE.TorusGeometry(0.126, 0.015, 5, 14).rotateX(Math.PI / 2), 0, -0.032), darkLeather);   // cuff welt
    p.add(xf(new THREE.CylinderGeometry(0.120, 0.112, 0.05, 12), 0, -0.058), rubber);                       // glove mouth
    // the mitten mass, cocked slightly forward as a relaxed hand hangs
    const mitt = new THREE.CapsuleGeometry(0.100, 0.112, 6, 14);
    mitt.scale(0.92, 1, 0.76);
    p.add(xf(mitt, 0, -0.150, 0.020, 0.22), rubber);
    for (let i = 0; i < 4; i++)                              // knuckle ridge across the back of the hand
      p.add(xf(new THREE.SphereGeometry(0.030, 7, 6).scale(1, 0.80, 1), (-1.5 + i) * 0.046, -0.196, 0.050), rubber);
    p.add(xf(new THREE.CapsuleGeometry(0.042, 0.142, 5, 10).rotateZ(Math.PI / 2), 0, -0.244, 0.038), rubber);   // curled fingers, one roll
    p.add(xf(new THREE.CapsuleGeometry(0.033, 0.126, 4, 9).rotateZ(Math.PI / 2), 0, -0.282, 0.012), rubber);
    // opposed thumb, outboard: two phalanges and a knuckle
    p.add(xf(new THREE.CapsuleGeometry(0.036, 0.058, 4, 8), s * 0.080, -0.168, 0.048, 0.45, 0, s * 0.85), rubber);
    p.add(xf(new THREE.CapsuleGeometry(0.030, 0.048, 4, 8), s * 0.100, -0.218, 0.076, 0.95, 0, s * 0.55), rubber);
    p.add(xf(new THREE.SphereGeometry(0.027, 6, 5), s * 0.090, -0.198, 0.062), darkLeather);
    p.bake();
  }

  // BOOTS. The shank now tapers to a 0.112 ankle, so the boot flares back out over it:
  // sock cuff, a lathed leather ankle flare, then a foot with actual form — a vamp, a
  // domed toe box, a stacked heel block under a lead sole. The sole's underside stays at
  // local y ~ -0.365: LIFT is derived against it to plant Sal on the collision floor.
  for (const leg of [g.legR, g.legL]) {
    const p = Part(leg.end);
    p.add(fold(xf(band(0.128, 0.15, 0.95, 14), 0, -0.018), 0.011, 15, 0.74), cloth);
    p.add(xf(band(0.134, 0.046, 0.95, 14), 0, 0.058), trim);
    // Ankle flare: the boot's leather cuff opening out from the narrow ankle. A CLOSED
    // solid, not an open lathe skirt — an open lathe here showed its back faces through
    // the mouth and read as a lampshade hung round the leg.
    p.add(xf(new THREE.CylinderGeometry(0.120, 0.170, 0.20, 14, 1).scale(1, 1, 0.96), 0, -0.095), leather);
    p.add(xf(new THREE.TorusGeometry(0.168, 0.021, 6, 16).rotateX(Math.PI / 2).scale(1, 1, 0.96), 0, -0.176), darkLeather);
    // vamp: the body of the foot, broader at the ball than at the ankle. These are
    // WEIGHTED boots — a hundredweight of brass and lead between the two of them — so the
    // foot has to out-mass the ankle by a lot or it reads as a slipper under a heavy leg.
    const vamp = new THREE.CapsuleGeometry(0.120, 0.21, 6, 12).rotateX(Math.PI / 2);
    vamp.scale(1.06, 0.90, 1);
    p.add(xf(vamp, 0, -0.238, 0.070), leather);
    for (let i = 0; i < 4; i++) {                            // laces over the instep
      p.add(xf(new THREE.CylinderGeometry(0.011, 0.011, 0.21, 5).rotateZ(Math.PI / 2), 0, -0.150 + i * 0.012, 0.05 + i * 0.054, 0.28, 0, 0), darkLeather);
      for (const sx of [1, -1]) p.add(xf(new THREE.SphereGeometry(0.015, 5, 4), sx * 0.106, -0.150 + i * 0.012, 0.05 + i * 0.054), brass);
    }
    p.add(xf(new THREE.BoxGeometry(0.252, 0.052, 0.072), 0, -0.230, 0.105), darkLeather);   // instep strap
    p.add(xf(new THREE.BoxGeometry(0.06, 0.045, 0.02), 0.124, -0.230, 0.105), brass);
    const toe = new THREE.SphereGeometry(0.124, 12, 8);       // toe box: wider than it is tall
    toe.scale(1.10, 0.80, 1.26);
    p.add(xf(toe, 0, -0.244, 0.185), leather);
    // toe RAND, not a capping sphere: a co-surfaced cap z-fought the toe box into a
    // sawtooth. A band wrapped round the front of the box is the real detail anyway.
    p.add(xf(new THREE.TorusGeometry(0.114, 0.021, 6, 16, Math.PI * 1.15).scale(1.14, 0.86, 1)
      .rotateX(Math.PI / 2).rotateY(-Math.PI * 0.075), 0, -0.252, 0.200), steel);
    p.add(xf(new THREE.BoxGeometry(0.210, 0.085, 0.150), 0, -0.306, -0.085), darkLeather);                // stacked heel block
    p.add(xf(new THREE.BoxGeometry(0.250, 0.055, 0.46), 0, -0.328, 0.055), rubber);                       // thick sole
    p.add(xf(new THREE.BoxGeometry(0.262, 0.026, 0.472), 0, -0.3505, 0.055), steel);                      // lead sole plate
    rivetRing(p, brass, 10, 0.120, -0.3505, 0.016, 1.9);
    p.bake();
  }

  // ---- knife rig: scabbard strapped to the LEFT thigh (the right hand holds the lantern) ----
  {
    const { r } = g.legL;
    // TH swings the whole rig round to the outboard-rear quarter of the thigh: dead
    // outboard puts the hilt inside the hanging fist, and the draw wants it behind the palm.
    const TH = 0.62, ct = Math.cos(TH), st = Math.sin(TH);
    // two retaining straps over the trouser, offset from the existing thigh straps
    const p = Part(g.legL.root);
    for (const yy of [-0.155, -0.335]) {
      p.add(xf(band(r * 1.10, 0.040, 0.95, 14), 0, yy), darkLeather);
      for (const sz of [1, -1]) p.add(xf(new THREE.SphereGeometry(0.013, 6, 5), r * 1.02, yy, sz * 0.055), brass);
      // the same strap carries on over the scabbard's outboard face, with a stud
      p.add(xf(new THREE.BoxGeometry(0.022, 0.038, 0.130), r * 1.46 * ct, yy, -r * 1.46 * st, 0, TH, 0.10), darkLeather);
      p.add(xf(new THREE.SphereGeometry(0.013, 6, 5), r * 1.50 * ct + 0.04 * st, yy, -r * 1.50 * st + 0.04 * ct), brass);
    }
    p.bake();

    // scabbard frame: outboard-rear face of the thigh, hilt canted forward to the hand.
    // Outer group carries the cant; the inner one turns the scabbard's flat faces
    // outboard (its geometry is flattened in Z), so it lies against the thigh.
    const sh = new THREE.Group();
    sh.position.set(r * 1.24 * ct, -0.235, -r * 1.24 * st);
    sh.rotation.set(0.16, TH, 0.10);
    // the suit is a big, stylised silhouette: the knife is widened (not lengthened) so it
    // still reads as a heavy dive knife from the gameplay camera
    sh.scale.set(1.40, 1.06, 1.40);
    g.legL.root.add(sh);
    const sh2 = new THREE.Group();
    sh2.rotation.y = Math.PI / 2 + 0.10;
    sh.add(sh2);
    sheathGeo(Part(sh2)).bake();
    g.knifeSheath = sh;

    // the knife itself, twice: home in the scabbard, and gripped in the left fist.
    // triggerSlash() just swaps which one is visible — no reparenting, no allocation.
    const home = new THREE.Group();
    home.position.y = 0.090;
    sh2.add(home);
    knifeGeo(Part(home)).bake();
    g.knifeHome = home;

    const held = new THREE.Group();
    held.position.set(0.030, -0.208, 0.062);
    held.rotation.set(-1.62, 0, 0.16);          // blade forward out of the fist
    held.scale.set(1.40, 1.06, 1.40);
    held.visible = false;
    g.armL.end.add(held);
    knifeGeo(Part(held)).bake();
    g.knifeHeld = held;

    // faint water-drag arc: one flattened ring segment in the swing plane, additive,
    // opacity driven only while the blade is moving. Single mesh, no shadow.
    const arc = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.34, 12, 1, 1.05, 1.35), dragMat);
    arc.rotation.set(Math.PI / 2, 0, 0);
    arc.position.set(0, -0.235, 0.10);
    arc.castShadow = arc.receiveShadow = false;
    arc.visible = false;
    g.armL.end.add(arc);
    g.slashArc = arc;
  }

  // The old 5-segment "surface umbilical" stub that dangled off the neck is gone:
  // the real verlet tether (systems/tether.js) now docks at the backpack inlet, and
  // the stub just clipped through the torso next to it.

  // ---- lantern: brass cage, glass panes, live flame ----
  {
    const pivot = new THREE.Group();
    pivot.position.set(0, -0.278, 0.10);
    g.armR.end.add(pivot);
    g.lantPivot = pivot;
    const bail = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.011, 5, 14, Math.PI), brass);
    bail.rotation.y = Math.PI / 2; pivot.add(bail);
    const lantern = new THREE.Group();
    lantern.position.y = -0.085;
    lantern.scale.setScalar(1.25);
    pivot.add(lantern);

    const cage = Part(lantern);   // thin members cast the streaked light pattern
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * TAU + Math.PI / 4;
      cage.add(xf(new THREE.BoxGeometry(0.022, 0.25, 0.022), Math.cos(a) * 0.098, -0.145, Math.sin(a) * 0.098, 0, -a, 0), brass);
    }
    cage.add(xf(new THREE.TorusGeometry(0.098, 0.010, 5, 14).rotateX(Math.PI / 2), 0, -0.085), brass);
    cage.add(xf(new THREE.TorusGeometry(0.098, 0.010, 5, 14).rotateX(Math.PI / 2), 0, -0.205), brass);
    cage.bake(true);

    const shell = Part(lantern);  // bulky caps: no shadow, they'd swallow the seafloor light
    shell.add(lathe([[0.000, 0.02], [0.055, 0.015], [0.075, -0.005], [0.118, -0.03], [0.128, -0.048], [0.106, -0.055], [0.100, -0.062]], 14), brass);
    shell.add(lathe([[0.000, -0.315], [0.105, -0.312], [0.118, -0.295], [0.112, -0.255], [0.100, -0.245]], 14), brass);
    shell.add(xf(new THREE.CylinderGeometry(0.086, 0.086, 0.185, 12, 1, true), 0, -0.145), lantGlass);
    shell.bake(false);

    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.030, 0.10, 7), flameMat);
    flame.position.y = -0.15; lantern.add(flame);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2cf }));
    core.position.y = -0.175; lantern.add(core);
    const glow = makeGlow(0xffdf9e, 0.75);
    glow.position.y = -0.16; lantern.add(glow);

    const lant = new THREE.Group();   // lanternWorldPos() resolves through this
    lant.position.y = -0.16;
    lantern.add(lant);
    g.lant = lant; g.flame = flame; g.glow = glow; g.core = core;
  }

  scene.add(g);
  return g;
})();

// ---- exhaust bubbles ----
const BUBN = 60;
const bubbles = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 7, 5),
  new THREE.MeshStandardMaterial({
    color: 0xd6ecff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.5,
    depthWrite: false, envMap: envTex, envMapIntensity: 1.6
  }), BUBN);
bubbles.frustumCulled = false;
bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
bubbles.castShadow = bubbles.receiveShadow = false;
scene.add(bubbles);
const bub = [];
for (let i = 0; i < BUBN; i++) bub.push({ p: V3(), v: V3(), r: 0, life: 0, max: 1, ph: Math.random() * 7 });

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _sv = V3(1, 1, 1), _tmp = V3(), _ex = V3();
let bubCursor = 0, breathT = 1.2, trickle = 0;

function emitBubble(at, vel) {
  const b = bub[bubCursor]; bubCursor = (bubCursor + 1) % BUBN;
  b.p.copy(at).add(_tmp.set(rng(-0.05, 0.05), rng(-0.03, 0.03), rng(-0.05, 0.05)));
  b.v.set(rng(-0.16, 0.16), rng(0.85, 1.5), rng(-0.16, 0.16)).addScaledVector(vel, 0.22);
  b.r = rng(0.014, 0.046);
  b.max = rng(1.8, 3.2); b.life = b.max;
}

function updateBubbles(dt, t, vel) {
  for (let i = 0; i < BUBN; i++) {
    const b = bub[i];
    if (b.life > 0) {
      b.life -= dt;
      b.v.y = Math.min(2.1, b.v.y + 0.7 * dt);
      b.v.x *= 0.985; b.v.z *= 0.985;
      b.p.addScaledVector(b.v, dt);
      b.p.x += Math.sin(t * 3.1 + b.ph) * 0.10 * dt * 8;     // wobble as they rise
      b.p.z += Math.cos(t * 2.6 + b.ph * 1.7) * 0.10 * dt * 8;
      // A bubble that reaches the surface bursts there. Without this the ones released
      // just under the waterline kept climbing into the sky.
      if (b.p.y >= SURFACE_Y) b.life = 0;
      const k = b.life / b.max;
      _sv.setScalar(b.r * (1.35 - 0.35 * k) * ss(0, 0.16, 1 - k) * ss(0, 0.30, k));
    } else _sv.setScalar(0);
    _m4.compose(b.p, _q, _sv);
    bubbles.setMatrixAt(i, _m4);
  }
  bubbles.instanceMatrix.needsUpdate = true;
}

// ---- walk cycle: authored curves, phase 0 = right heel strike ----
const W = {
  hip: curve([[0, .46], [.12, .32], [.25, .10], [.38, -.14], [.50, -.36], [.58, -.30], [.68, -.02], [.80, .34], [.90, .53]]),
  knee: curve([[0, .07], [.08, .31], [.18, .15], [.35, .06], [.50, .27], [.60, .88], [.72, .74], [.85, .34], [.95, .05]]),
  ankle: curve([[0, -.24], [.10, .06], [.30, .02], [.46, .32], [.55, .10], [.70, -.20], [.88, -.26]]),
  bob: curve([[0, -.05], [.09, -.088], [.16, -.045], [.26, .036], [.38, .004], [.50, -.05], [.59, -.088], [.66, -.045], [.76, .036], [.88, .004]]),
  sway: curve([[0, -.025], [.20, -.082], [.34, -.03], [.50, .025], [.70, .082], [.84, .03]]),
  list: curve([[0, 0], [.25, -.09], [.50, 0], [.75, .09]]),
  yaw: curve([[0, .175], [.25, .04], [.50, -.175], [.75, -.04]]),
  // Arm swing gets its OWN curve instead of borrowing the hip's. A hip reverses fast
  // (the leg is driven); an arm is a pendulum hung off a shoulder inside stiff canvas, so
  // it dwells at each end of the swing and moves quickest through the passing position.
  // Normalised to +/-1 and symmetric, extremes at p=0 and p=0.5.
  arm: curve([[0, -1.0], [.06, -.96], [.14, -.78], [.25, 0], [.36, .78], [.44, .96],
  [.50, 1.0], [.56, .96], [.64, .78], [.75, 0], [.86, -.78], [.94, -.96]])
};
// frog kick: slow tuck (0-.45), snap (.45-.62), long glide
const S = {
  hip: curve([[0, .10], [.22, .52], [.45, .92], [.55, .40], [.64, .04], [.80, .06], [.92, .08]]),
  knee: curve([[0, .18], [.22, .78], [.45, 1.45], [.55, .60], [.64, .06], [.80, .10], [.92, .14]]),
  abd: curve([[0, .05], [.22, .22], [.45, .44], [.55, .30], [.64, .04], [.80, .04], [.92, .05]]),
  ankle: curve([[0, 0], [.30, -.30], [.48, -.34], [.58, .26], [.70, .06], [.88, .02]])
};

const CH = {
  bobY: 0, shiftX: 1, shiftZ: 2, pYaw: 3, pRoll: 4, pPitch: 5, sYaw: 6, sPitch: 7, sRoll: 8, nYaw: 9, nPitch: 10,
  Rhx: 11, Rhz: 12, Rk: 13, Ra: 14, Lhx: 15, Lhz: 16, Lk: 17, La: 18,
  Rsx: 19, Rsz: 20, Rsy: 21, Re: 22, Lsx: 23, Lsz: 24, Lsy: 25, Le: 26, N: 27
};
const pw = new Float32Array(CH.N), psw = new Float32Array(CH.N), po = new Float32Array(CH.N);

// Phase offsets, in cycles. At a walking cadence of ~1.1 cycles/s these are the timings
// that stop the gait reading as one rigid marionette: the pelvis leads, the shoulders
// answer it a beat later, the arms trail further still.
const SH_LAG = 0.085;      // shoulders lag the hips ~75 ms
const ARM_LAG = 0.045;     // arms trail the opposing leg on top of their own 0.08 offset

// tanh(2.2) — normalises the weight-shift clip so the shift still reaches +/-1
const TANH22 = 0.975743;

function poseWalk(o, p, a, t, deck) {
  const idle = 1 - a;                                        // at a standstill every cyclic term falls away
  // ---- idle, SPLIT BY GROUND. Planks are not water. ----
  // SEA idle (deck=0): he is standing in a moving column, so the sway survives — but the
  // vertical is HALVED from the old value. A man in lead boots on the bottom is heavy;
  // he does not float.
  // DECK idle (deck=1): terrestrial and planted. Zero vertical bob. Weight shifts foot to
  // foot on a ~30 s period with a dwell at each foot (tanh-clipped sine), the pelvis lists
  // onto the loaded leg and the shoulders counter it, breathing lives in the SHOULDERS
  // rather than the pelvis, and the head turns occasionally. The head gate is a sparse
  // deterministic function of t — never Math.random(), which would make the turn
  // frame-rate dependent and unrepeatable between sessions.
  const wob = Math.sin(t * 0.47);
  const brS = Math.sin(t * 0.90);                            // ~8.6 breaths a minute
  const wsh = Math.tanh(2.2 * Math.sin(t * 0.21)) / TANH22;  // +1 = weight on his left foot
  const look = 0.30 * ss(0.88, 1, Math.sin(t * 0.137)) - 0.26 * ss(0.88, 1, Math.sin(t * 0.0912 + 2.1));
  const dk = deck * idle, sw = (1 - deck) * idle;

  o[CH.bobY] = W.bob(p) * a + Math.sin(t * 1.15) * 0.007 * sw;
  o[CH.shiftX] = W.sway(p) * a + wob * 0.028 * sw + wsh * 0.030 * dk;
  o[CH.shiftZ] = 0;
  o[CH.pYaw] = W.yaw(p) * a + wsh * 0.020 * dk;
  o[CH.pRoll] = W.list(p) * a + wob * 0.032 * sw + wsh * 0.038 * dk;
  o[CH.pPitch] = 0;
  o[CH.sYaw] = -1.5 * W.yaw(p - SH_LAG) * a - wsh * 0.030 * dk + brS * 0.006 * dk;
  o[CH.sPitch] = -(0.07 + 0.11 * a) + Math.sin(t * 1.15 + 0.6) * 0.022 * sw + brS * 0.020 * dk;
  o[CH.sRoll] = -0.6 * W.list(p - SH_LAG * 0.7) * a - wsh * 0.021 * dk;
  o[CH.nYaw] = look * dk; o[CH.nPitch] = 0.05 * a - 0.02 * Math.abs(look) * dk;
  o[CH.Rhx] = -W.hip(p) * a; o[CH.Rhz] = 0.075;
  o[CH.Rk] = W.knee(p) * a + 0.07 * idle + 0.022 * wsh * dk; o[CH.Ra] = W.ankle(p) * a;
  o[CH.Lhx] = -W.hip(p + 0.5) * a; o[CH.Lhz] = 0.075;
  o[CH.Lk] = W.knee(p + 0.5) * a + 0.07 * idle - 0.022 * wsh * dk; o[CH.La] = W.ankle(p + 0.5) * a;
  // Arms trail the opposing leg on W.arm's eased pendulum profile. Centre and half-range
  // reproduce the old -W.hip() swing exactly, so the reach of the swing is unchanged; what
  // changed is WHEN it gets there and how it turns around.
  const ra = (0.445 * W.arm(p - 0.08 - ARM_LAG) - 0.09) * a;
  const la = (0.445 * W.arm(p + 0.42 - ARM_LAG) - 0.09) * a;
  o[CH.Rsx] = -ra * 0.34 - 0.10 - wsh * 0.012 * dk; o[CH.Rsz] = 0.18; o[CH.Rsy] = -0.10;
  o[CH.Re] = -(0.44 + Math.max(0, -ra) * 0.35);
  o[CH.Lsx] = -la * 0.62 + wsh * 0.012 * dk; o[CH.Lsz] = 0.15; o[CH.Lsy] = 0.05;
  o[CH.Le] = -(0.20 + Math.max(0, -la) * 0.5);
}

// A limb dragging through water reverses SLOWLY — drag is largest exactly where the
// velocity is largest, so the stroke flattens at its turnarounds. Peak is still 1.0, so
// every amplitude this replaces keeps its old range.
const dragS = x => { const s = Math.sin(x); return s * (1.15 - 0.15 * s * s); };
const SWIM_DRAG = 0.28;    // seconds the arms trail the body's roll/yaw

function poseSwim(o, p, t, drive) {
  const td = t - SWIM_DRAG;
  // The kick's phase is warped so the tuck and the glide — the two extremes — take longer
  // than the transit between them. Pure reparametrisation: every S curve keeps its range.
  const pk = p - 0.022 * Math.sin(4 * Math.PI * (p - 0.45));
  o[CH.bobY] = Math.sin(t * 0.9) * 0.035;
  o[CH.shiftX] = Math.sin(t * 0.62) * 0.03;
  o[CH.shiftZ] = 0;
  o[CH.pYaw] = Math.sin(t * 0.5) * 0.05;
  o[CH.pRoll] = Math.sin(t * 0.71) * 0.06;
  o[CH.pPitch] = -0.10 - S.hip(pk) * 0.10;
  o[CH.sYaw] = Math.sin(t * 0.44 + 1) * 0.07;
  o[CH.sPitch] = 0.10 + S.hip(pk) * 0.06;
  o[CH.sRoll] = Math.sin(t * 0.58) * 0.07;
  o[CH.nYaw] = Math.sin(t * 0.33) * 0.06; o[CH.nPitch] = -0.06;
  const k = 0.45 + 0.55 * drive;
  o[CH.Rhx] = -S.hip(pk) * k; o[CH.Rhz] = 0.06 + S.abd(pk) * k;
  o[CH.Rk] = S.knee(pk) * k; o[CH.Ra] = S.ankle(pk) * k;
  o[CH.Lhx] = -S.hip(pk + 0.03) * k; o[CH.Lhz] = 0.06 + S.abd(pk + 0.03) * k;   // slight asymmetry
  o[CH.Lk] = S.knee(pk + 0.03) * k; o[CH.La] = S.ankle(pk + 0.03) * k;
  // arms on the delayed clock: they answer the roll the torso had a third of a second ago
  o[CH.Rsx] = -0.42 - dragS(td * 0.8) * 0.10; o[CH.Rsz] = 0.34; o[CH.Rsy] = -0.22;
  o[CH.Re] = -(0.85 + dragS(td * 0.8 + 0.6) * 0.10);
  o[CH.Lsx] = -0.22 + dragS(td * 0.66 + 2) * 0.30; o[CH.Lsz] = 0.42 + dragS(td * 0.5) * 0.10; o[CH.Lsy] = 0.18;
  o[CH.Le] = -(0.55 + dragS(td * 0.66 + 1.2) * 0.28);
}

// ---- knife slash: a one-shot keyed overlay on the LEFT arm ----
// Authored as explicit keys with a per-segment ease so the weight reads right: the draw
// and windup ease OUT (the suit fights him, the arm settles into the cock), the sweep
// eases IN (power builds into contact at 0.220 — game.js checks the hit at t+0.22), the
// follow-through overshoots and the recovery is slow.
const SLASH_DUR = 0.55, SLK_ST = 7;
// t, Lsx (back+), Lsy (yaw, out+), Lsz (abduct+), Le (elbow), spine twist, ease-into-key
const SLK = new Float32Array([
  0.000, 0.00, 0.05, 0.15, -0.20, 0.00, 0,
  0.070, 0.16, 0.34, 0.10, -0.62, 0.06, 0,   // fist closes on the hilt at the thigh
  0.110, 0.34, 0.52, 0.30, -1.55, 0.12, 1,   // knife clears the throat, elbow folds
  0.150, 0.60, 0.62, 0.86, -1.42, 0.22, 3,   // cocked high and outboard — anticipation
  0.220, -0.56, -0.72, -0.34, -0.30, -0.26, 2,   // CONTACT, arm driven across the body
  0.300, -0.82, -1.02, -0.66, -0.52, -0.34, 3,   // heavy follow-through overshoot
  0.420, -0.12, -0.20, 0.12, -1.24, -0.10, 4,   // slow recovery, elbow back to the hip
  0.500, 0.14, 0.30, 0.16, -0.72, 0.05, 4,   // hilt back at the scabbard throat
  0.550, 0.00, 0.05, 0.15, -0.20, 0.00, 0
]);
const SLN = SLK.length / SLK_ST;
const slA = new Float32Array(5);
let slashT = -1;

function easeSeg(u, m) {
  if (m === 1) return 1 - (1 - u) * (1 - u);                 // ease-out quad
  if (m === 2) return u * u * u;                             // ease-in cubic: power builds
  if (m === 3) { const k = 1 - u; return 1 - k * k * k; }     // ease-out cubic: heavy arrival
  if (m === 4) { const s = u * u * (3 - 2 * u); return s * s * (3 - 2 * s); }   // very soft
  return u * u * (3 - 2 * u);
}

function evalSlash(ts) {
  let i = 0;
  while (i < SLN - 1 && SLK[(i + 1) * SLK_ST] <= ts) i++;
  const a = i * SLK_ST, b = Math.min(i + 1, SLN - 1) * SLK_ST;
  const t0 = SLK[a], t1 = SLK[b];
  const u = t1 > t0 ? easeSeg(clamp((ts - t0) / (t1 - t0), 0, 1), SLK[b + 6]) : 1;
  for (let c = 0; c < 5; c++) slA[c] = SLK[a + 1 + c] + (SLK[b + 1 + c] - SLK[a + 1 + c]) * u;
}

// ---- runtime state ----
// Legs are 8% longer and the boots deeper than the old build, so LIFT is re-derived to keep
// the soles planted on player.pos - 1.35 (the collision floor) in the rest pose.
const LIFT = 0.163;
// gb boots at 1 (standing), not 0: every session now opens with Sal on the raft's deck
// behind the title, and a 0 boot meant the first thing anyone ever saw was the frog-kick
// pose easing out — legs drawn up, boots half a metre off the planks he is standing on.
let walkP = 0, swimP = 0, gb = 1, yawF = 0, yawInit = false;
// deckF boots at 1 for the same reason gb does: the title opens on Sal standing on planks.
let deckF = 1, ampS = 0;
// Ground covered by one full walk cycle (two steps). MEASURED off the rig, not chosen:
// the right boot's fore-aft excursion in the body frame at steady walk is 1.135 units,
// so a cycle carries him 2 x 1.135. At the old 2.35 the cadence was 3.4% slow — the
// stride integrated 3.4% less ground than he covered, and the difference came out as a
// slow backward creep under the boot. That is now zero over the stride.
// HONEST LIMIT, for the record: the authored gait has no constant-velocity stance —
// the ideal divisor swings from 2.5 to 0.6 WITHIN the contact window — so a residual
// intra-stance slip of ~0.5x speed remains at every possible divisor (best case 0.49
// RMS at D=1.68, which would also turn the walk into a scurry). Removing it needs the
// hip/knee curves re-keyed with a flat stance, not a different number here.
const STRIDE_U = 2.27;
// Sustained-yaw bank: a swimmer turning leans into the turn and holds the lean while the
// turn lasts. sRollT's existing term is a LAG (yaw minus the body's filtered yaw), which
// decays to nothing the moment the turn is steady — the very case that wants a bank. This
// is the rate channel: smoothed d(yaw)/dt, eased in and out by the same spring.
let prevYaw = 0, yawRate = 0, prevYawInit = false;
// Scull arm bias, eased so the posture arrives and leaves rather than snapping.
const scX = { x: 0, v: 0 }, scZ = { x: 0, v: 0 };
const sPitch = { x: 0, v: 0 }, sRollT = { x: 0, v: 0 };
// heel-strike knee soften, and the trailing wrists/ankles (secondary motion, sprung rather
// than keyed — same idiom as the helmet lag). Wrist targets are REST-RELATIVE so the rest
// pose, and with it the knife's held geometry and the lantern bail, is untouched.
const kneeSoft = { x: 0, v: 0 };
let kneeSide = 0;
const wrR = { x: 0, v: 0 }, wrL = { x: 0, v: 0 };
const ankR = { x: 0, v: 0 }, ankL = { x: 0, v: 0 };
const REST_RE = -0.44, REST_LE = -0.20;

const lnX = { x: 0, v: 0 }, lnZ = { x: 0, v: 0 };
const hdY = { x: 0, v: 0 }, hdX = { x: 0, v: 0 };
const settle = { x: 0, v: 0 };
const prevHand = V3(), handV = V3();
let lastStepSide = 0;
// Monotonic count of actual heel strikes. game.js diffs it to fire footstep audio in
// sync with the animation, instead of guessing the cadence from a fixed frequency.
let steps = 0;
export function stepCount() { return steps; }

// Pose the diver from player state. grounded => weighted lead-boot walk; else => frog kick.
export function updateDiver(dt, t, player) {
  diver.position.copy(player.pos);
  const speed = player.vel.length();
  const flat = Math.hypot(player.vel.x, player.vel.z);

  if (!yawInit) { yawF = player.yaw; yawInit = true; }
  // the body trails the look direction: tight on the seafloor, loose and laggy in water
  yawF = lerp(yawF, player.yaw, Math.min(1, (player.grounded ? 9 : 2.6) * dt));
  diver.rotation.y = yawF;

  // Stepping onto planks kills the aquatic motion in ~0.15 s rather than half a second:
  // the deck is a hard, dry contract with the world, and swim bob leaking past the ladder
  // was the single most visible thing wrong with him. Off the deck the old soft 4.5/s
  // stands — settling onto the seabed IS gradual, you sink into it.
  gb = lerp(gb, player.grounded ? 1 : 0, Math.min(1, (player.onDeck ? 10 : 4.5) * dt));
  deckF = lerp(deckF, player.onDeck ? 1 : 0, Math.min(1, 10 * dt));
  // Effective weight on the soles. Same expression player.js walks by (GROUND_BUOY 0.9,
  // A_BUOY_MIN -1.83); duplicated as two literals rather than imported, because diver.js
  // is a pose module and must stay loadable behind the title with no physics running.
  const wgt = player.onDeck ? 1 : clamp((0.9 - (player.buoy || 0)) / 2.73, 0, 1);

  // stride advances with distance travelled, capped so a boosted sprint doesn't turn into a scurry
  // STRIDE_U is the ground the walk cycle covers in one cycle (two steps). It is not a
  // taste value: measured against the rig, one stride carries the sole ~1.19 units, so a
  // cycle is 2.38 and the feet hold their world position through stance. The old 2.35 was
  // within 1.3% of that and never slid visibly; it is written as its own name now so the
  // relationship is stated rather than remembered.
  const stepRate = clamp(flat / STRIDE_U, 0, 2.1);
  walkP = (walkP + stepRate * dt) % 1;
  swimP = (swimP + (0.24 + speed * 0.028) * dt) % 1;
  // Published to player.js, which shapes the forward thrust on swimP (the visible kick IS
  // the push) and lands the per-stride water resistance on walkP's heel strike. Two scalar
  // stores; no allocation, no new clock, no second source of truth.
  player.walkP = walkP; player.swimP = swimP;

  // Gait amplitude used to be velocity ALONE, so the cycle snapped on and off with the
  // stick. It now has an envelope: a short attack (he leans into the walk) and a longer
  // release (he settles out of it and the last stride finishes). walkP is untouched, so
  // the heel-strike cadence — and the footstep audio that keys off it — is unchanged.
  const ampT = clamp(flat * 0.42 - 0.06, 0, 1);
  ampS = lerp(ampS, ampT, Math.min(1, (ampT > ampS ? 8.3 : 4.0) * dt));   // ~0.12 s / ~0.25 s
  const amp = ampS;
  poseWalk(pw, walkP, amp, t, deckF);
  poseSwim(psw, swimP, t, clamp(speed * 0.09, 0, 1));
  for (let i = 0; i < CH.N; i++) po[i] = psw[i] + (pw[i] - psw[i]) * gb;

  // ---- SCULLS. Backing up and crabbing sideways are not swimming, and they should not
  // look like it: the arms come out of the streamlined trail into a shallow paddle. This
  // is a BIAS on the existing swim pose, not a new animation — four channels, sprung so
  // it eases in and out, and it fades out entirely the moment his boots find the ground.
  const sw = 1 - gb;
  spring(scX, (player.scullX || 0) * sw, dt, 5, 0.85);
  spring(scZ, (player.scullZ || 0) * sw, dt, 5, 0.85);
  if (scX.x !== 0 || scZ.x !== 0) {
    // sideways: the leading arm sweeps across the chest, the trailing arm abducts out
    po[CH.Rsz] += 0.22 * scX.x; po[CH.Lsz] -= 0.22 * scX.x;
    po[CH.Rsy] += 0.14 * scX.x; po[CH.Lsy] += 0.14 * scX.x;
    // backing: both hands come forward and the elbows open, palms pushing ahead of him
    po[CH.Rsx] += 0.34 * scZ.x; po[CH.Lsx] += 0.34 * scZ.x;
    po[CH.Re] += 0.26 * scZ.x; po[CH.Le] += 0.26 * scZ.x;
  }

  // Slash overlay: blends over the left-arm channels (plus a touch of spine twist) rather
  // than replacing the pose, so the gait keeps driving everything else and the arm eases
  // back into whatever it was doing when the swing ends.
  if (slashT >= 0) {
    slashT += dt;
    const w = ss(0, 0.055, slashT) * (1 - ss(SLASH_DUR - 0.075, SLASH_DUR, slashT));
    evalSlash(slashT);
    po[CH.Lsx] += (slA[0] - po[CH.Lsx]) * w;
    po[CH.Lsy] += (slA[1] - po[CH.Lsy]) * w;
    po[CH.Lsz] += (slA[2] - po[CH.Lsz]) * w;
    po[CH.Le] += (slA[3] - po[CH.Le]) * w;
    po[CH.sYaw] += slA[4] * w * 0.85;
    po[CH.sRoll] += slA[4] * w * 0.25;
    const held = slashT >= 0.085 && slashT < 0.505;
    if (diver.knifeHeld.visible !== held) { diver.knifeHeld.visible = held; diver.knifeHome.visible = !held; }
    const dr = 0.30 * ss(0.135, 0.19, slashT) * (1 - ss(0.235, 0.34, slashT));
    diver.slashArc.visible = dr > 0.002;
    dragMat.opacity = dr;
    if (slashT >= SLASH_DUR) {
      slashT = -1;
      diver.knifeHeld.visible = false; diver.knifeHome.visible = true;
      diver.slashArc.visible = false; dragMat.opacity = 0;
    }
  }

  // a heel strike drops a little extra weight through the frame — the "settle"
  const side = walkP < 0.5 ? 0 : 1;
  if (side !== lastStepSide) {
    lastStepSide = side;
    // Weight through the frame, not a fixed thump: a vented dress puts the whole 170 kg
    // through the heel; a blown-up one lands like a man on the moon. `wgt` mirrors
    // player.js's walk law exactly (1 = planted, 0 = floating off the bottom), and on
    // planks it is 1 because air holds nothing up.
    settle.v -= 2.25 * (0.45 + 0.75 * wgt) * gb * amp;
    // the landing leg takes the weight: a short knee soften, ~5 degrees, peaking ~78 ms in
    kneeSoft.v += 4.0 * gb * amp;
    kneeSide = side;
    // Audio keys off the same event that drops the visual weight, so boot sounds can
    // never drift from the animation no matter how the gait is retimed.
    if (gb > 0.5 && amp > 0.08) steps++;
  }
  // A light dress settles SLOWER as well as less far — the recovery is the moon-walk.
  spring(settle, 0, dt, 7 + 4 * wgt, 0.34);
  spring(kneeSoft, 0, dt, 20, 0.55);
  const ks = Math.max(0, kneeSoft.x) * 0.42;
  if (kneeSide === 0) po[CH.Rk] += ks; else po[CH.Lk] += ks;

  const b = diver.body;
  // LIFT plants the soles on player.pos - 1.35 (the collision floor) in the rest pose
  b.position.set(po[CH.shiftX], LIFT + po[CH.bobY] + settle.x * 0.045, po[CH.shiftZ]);
  // Lead boots below, a copper helmet full of air above: the centres of gravity and
  // buoyancy are a metre apart, so the righting moment is an order of magnitude larger
  // than any couple he can generate — and it GROWS with every litre in the dress. He
  // leans; he never tips like a frogman. The lean also reads off horizontal speed only,
  // so the ending's pure-vertical ascent cannot drive it.
  const upright = 0.22 + 0.30 * (1 - (player.fill || 0));
  const hsp = Math.hypot(player.vel.x, player.vel.z);
  const pitchTarget = gb > 0.5 ? 0 : clamp(-player.pitch * upright + hsp * 0.010, -0.55, 0.55);
  spring(sPitch, pitchTarget, dt, 2.2, 0.90);
  // yaw rate, smoothed over ~0.25 s so a mouse jitter is not a bank
  if (!prevYawInit) { prevYaw = player.yaw; prevYawInit = true; }
  const dyaw = dt > 1e-5 ? (player.yaw - prevYaw) / dt : 0;
  prevYaw = player.yaw;
  yawRate = lerp(yawRate, dyaw, Math.min(1, 4 * dt));
  const bank = clamp(-yawRate * 0.13, -0.30, 0.30);
  spring(sRollT, (1 - gb) * (clamp(-(player.yaw - yawF) * 2.2, -0.5, 0.5) + bank), dt, 4, 0.8);
  b.rotation.set(sPitch.x + po[CH.pPitch] * (1 - gb), 0, sRollT.x);

  const h = diver.hips;
  h.rotation.set(0, po[CH.pYaw], po[CH.pRoll]);
  const sp = diver.spine;
  sp.rotation.set(po[CH.sPitch], po[CH.sYaw], po[CH.sRoll]);

  // brass helmet lags the torso, then over-settles
  spring(hdY, -0.5 * po[CH.sYaw] + po[CH.nYaw], dt, 7, 0.55);
  spring(hdX, -0.35 * po[CH.sPitch] + po[CH.nPitch], dt, 6.5, 0.6);
  diver.neck.rotation.set(hdX.x, hdY.x, 0);

  const R = diver.legR, L = diver.legL;
  R.root.rotation.set(po[CH.Rhx], 0, -po[CH.Rhz]);
  R.mid.rotation.x = po[CH.Rk];
  L.root.rotation.set(po[CH.Lhx], 0, po[CH.Lhz]);
  L.mid.rotation.x = po[CH.Lk];
  // Ankles TRAIL the shank instead of being welded to it (~50 ms at walking cadence). A
  // spring converges exactly on its target, so the rest pose — and LIFT's sole plant —
  // is bit-identical at a standstill; only the transitions gain the lag.
  R.end.rotation.x = spring(ankR, po[CH.Ra], dt, 34, 0.85);
  L.end.rotation.x = spring(ankL, po[CH.La], dt, 34, 0.85);

  const AR = diver.armR, AL = diver.armL;
  AR.root.rotation.set(po[CH.Rsx], po[CH.Rsy], -po[CH.Rsz]);
  AR.mid.rotation.x = po[CH.Re];
  AL.root.rotation.set(po[CH.Lsx], po[CH.Lsy], po[CH.Lsz]);
  AL.mid.rotation.x = po[CH.Le];
  // wrists relax after the elbow, measured from the rest fold so nothing static moves
  AR.end.rotation.x = spring(wrR, (po[CH.Re] - REST_RE) * 0.30, dt, 26, 0.75);
  AL.end.rotation.x = spring(wrL, (po[CH.Le] - REST_LE) * 0.30, dt, 26, 0.75);

  // hand velocity in the diver's own frame drives the lantern pendulum
  const c = Math.cos(-yawF), s = Math.sin(-yawF);

  // lantern swings on the bail with real inertia from the hand's motion
  diver.armR.end.getWorldPosition(_tmp);
  if (dt > 0) handV.copy(_tmp).sub(prevHand).multiplyScalar(1 / dt);
  prevHand.copy(_tmp);
  const hx = handV.x * c - handV.z * s, hz = handV.x * s + handV.z * c;
  spring(lnX, clamp(-hz * 0.055, -0.6, 0.6) - settle.x * 0.05, dt, 6.5, 0.24);
  spring(lnZ, clamp(hx * 0.055, -0.6, 0.6), dt, 6.5, 0.24);
  diver.lantPivot.rotation.set(lnX.x, 0, lnZ.x);

  // flame flicker, scaled by the player's remaining light
  const li = clamp(player.light, 0, 1);
  const fl = (0.82 + 0.18 * Math.sin(t * 11.3) + 0.10 * Math.sin(t * 27.7)) * (0.25 + 0.75 * li);
  diver.flame.scale.set(0.85 + fl * 0.3, fl * 1.15 + 0.2, 0.85 + fl * 0.3);
  diver.flame.material.opacity = 0.55 + 0.45 * fl;
  diver.core.scale.setScalar(0.7 + fl * 0.5);
  diver.glow.scale.setScalar(0.5 + fl * 0.55);
  diver.glow.material.opacity = 0.35 + 0.5 * fl;

  // breathing: a steady trickle plus a burst on every exhale — ONLY UNDER WATER.
  // The exhaust port is a one-way valve into the sea; standing on the raft deck he was
  // streaming bubbles up into the sky. Gated on the port's own world height rather than
  // the diver's, so the last of the exhale still leaves as his shoulders go under.
  diver.exhaust.getWorldPosition(_ex);
  const submerged = _ex.y < SURFACE_Y;
  breathT -= dt;
  if (breathT <= 0) {
    breathT = rng(2.9, 4.1);
    if (submerged) {
      const n = 6 + Math.floor(Math.random() * 6);
      for (let i = 0; i < n; i++) emitBubble(_ex, player.vel);
    }
  }
  trickle -= dt;
  if (trickle <= 0) { trickle = rng(0.16, 0.4); if (submerged) emitBubble(_ex, player.vel); }
  updateBubbles(dt, t, player.vel);
}

export function lanternWorldPos(target) {
  diver.lant.getWorldPosition(target);
  return target;
}

export function airInletWorldPos(target) {
  diver.hoseInlet.getWorldPosition(target);
  return target;
}

// ---- knife (implemented by the diver-knife agent) ----
// triggerSlash(): play the draw-and-slash animation once; returns false while one is
// already in flight so game.js can gate the hit check to the anim's contact frame.
export function triggerSlash() {
  if (slashT >= 0) return false;      // already committed; no cancelling mid-swing
  slashT = 0;
  return true;
}
