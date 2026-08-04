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
const leatherM = grainMaps([150, 88, 44], [214, 150, 92], 2, 0.60);   // warm tan-orange
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
function fold(geo, amp, freq, tone = 1) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, n = pos.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = fbm(x * freq + 11, z * freq + 3) - 0.5;
    const b = fbm(y * freq * 1.7 + 5, (x + z) * 0.7 * freq * 1.7 + 9) - 0.5;
    const c = fbm(y * freq * 4.1 + 21, (x - z) * freq * 4.1 + 2) - 0.5;
    const d = (a * 1.1 + b * 0.9 + c * 0.45) * amp;
    pos.setXYZ(i, x + nrm.getX(i) * d, y + nrm.getY(i) * d, z + nrm.getZ(i) * d);
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
    for (const sx of [-0.205, 0.205]) {                      // circular chest vent bosses
      p.add(xf(new THREE.CylinderGeometry(0.080, 0.090, 0.07, 14).rotateX(Math.PI / 2), sx, 0.424, 0.418), copper);
      p.add(xf(new THREE.TorusGeometry(0.076, 0.015, 5, 14), sx, 0.424, 0.452), brass);
      p.add(xf(new THREE.CylinderGeometry(0.060, 0.060, 0.03, 12).rotateX(Math.PI / 2), sx, 0.424, 0.452), port);
      for (let i = 0; i < 3; i++)                            // louvre slats in the port
        p.add(xf(new THREE.BoxGeometry(0.102, 0.012, 0.014), sx, 0.424 + (i - 1) * 0.026, 0.464), steel);
    }
    // blue fabric torso: slightly broader in x than the carapace so it reads at the sides
    const t = lathe([[0.000, -0.16], [0.320, -0.17], [0.362, -0.06], [0.424, 0.10], [0.510, 0.30], [0.578, 0.470], [0.556, 0.560], [0.000, 0.572]], 22);
    t.scale(1, 1, 0.66);
    p.add(fold(t, 0.036, 7.5, 0.74), cloth);
    p.bake();
  }

  // ---- pelvis, wide leather belt, pouches ----
  {
    const p = Part(hips);
    const pel = new THREE.CapsuleGeometry(0.338, 0.16, 6, 18);
    pel.scale(1, 1, 0.86);
    p.add(fold(xf(pel, 0, 0.02, 0), 0.034, 8, 0.74), cloth);
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
  function limb(parent, x, y, upLen, loLen, r, taper, inward) {   // inward 0 = no fabric gusset
    const root = new THREE.Group(); root.position.set(x, y, 0); parent.add(root);
    const mid = new THREE.Group(); mid.position.y = -upLen; root.add(mid);
    const end = new THREE.Group(); end.position.y = -loLen; mid.add(end);
    const pu = Part(root), pl = Part(mid);
    pu.add(fold(xf(new THREE.CapsuleGeometry(r, upLen - r * 0.6, 7, 16), 0, -upLen * 0.5 + r * 0.1, 0), 0.030, 11), leather);
    pl.add(fold(xf(new THREE.CapsuleGeometry(r * taper, loLen - r * 0.5, 7, 16), 0, -loLen * 0.5 + r * 0.05, 0), 0.026, 12), leather);
    // blue fabric underlayer: a gusset down the inner limb and a ring at the joint
    if (inward) {
      pu.add(fold(xf(new THREE.CapsuleGeometry(r * 0.42, upLen * 0.44, 5, 10), inward * r * 0.80, -upLen * 0.54, 0), 0.020, 13, 0.74), cloth);
      // clears the sleeve's fold displacement (0.030) so the band never breaks into patches
      pu.add(xf(band(r * 1.24, 0.06, 0.98, 16), 0, -upLen * 0.20), trim);
    }
    pl.add(fold(xf(new THREE.CapsuleGeometry(r * 0.99, 0.05, 6, 14), 0, 0.015, 0), 0.018, 14, 0.74), cloth);
    return { root, mid, end, pu, pl, r, upLen, loLen, taper };
  }
  // the diver faces +Z, so his right side is -X
  g.armR = limb(spine, -0.500, 0.615, 0.50, 0.42, 0.150, 0.86, 1);
  g.armL = limb(spine, 0.500, 0.615, 0.50, 0.42, 0.150, 0.86, -1);
  g.legR = limb(hips, -0.225, 0.0, 0.562, 0.465, 0.186, 0.88, 0);
  g.legL = limb(hips, 0.225, 0.0, 0.562, 0.465, 0.186, 0.88, 0);

  // trousers: panel seams, stitched knee pads, thigh + under-knee straps
  for (const leg of [g.legR, g.legL]) {
    const { pu, pl, r, upLen, taper } = leg;
    for (const sz of [1, -1]) pu.add(xf(new THREE.BoxGeometry(0.020, upLen * 0.86, 0.026), 0, -upLen * 0.52, sz * r * 0.95), darkLeather);
    for (const sx of [1, -1]) pu.add(xf(new THREE.BoxGeometry(0.026, upLen * 0.86, 0.020), sx * r * 0.95, -upLen * 0.52, 0), darkLeather);
    for (const yy of [-0.20, -0.40]) {                       // thigh straps with tiny buckles
      pu.add(xf(band(r * 1.04, 0.048, 0.95, 14), 0, yy), darkLeather);
      pu.add(xf(new THREE.BoxGeometry(0.06, 0.055, 0.022), 0, yy, r * 1.02), brass);
    }
    const pad = new THREE.SphereGeometry(0.10, 12, 8);        // stitched knee pad, flattened
    pad.scale(1.42, 1.72, 0.40);
    pl.add(xf(pad, 0, -0.055, r * taper * 0.80), darkLeather);
    for (let i = 0; i < 12; i++) {                           // stitch dots round the pad
      const a = i / 12 * TAU;
      pl.add(xf(new THREE.SphereGeometry(0.011, 5, 4), Math.cos(a) * 0.128, -0.055 + Math.sin(a) * 0.155, r * taper * 0.86), leather);
    }
    pl.add(xf(band(r * taper * 1.05, 0.042, 0.95, 14), 0, -0.20), darkLeather);
    pl.add(xf(new THREE.BoxGeometry(0.055, 0.05, 0.022), 0, -0.20, r * taper * 1.02), brass);
  }
  for (const l of [g.armR, g.armL, g.legR, g.legL]) { l.pu.bake(); l.pl.bake(); }

  // gauntlets: white band, blue band, dark glove with finger definition
  for (const [arm, s] of [[g.armR, -1], [g.armL, 1]]) {
    const p = Part(arm.end);
    p.add(xf(band(0.152, 0.05, 0.95, 14), 0, 0.062), trim);
    p.add(fold(xf(band(0.147, 0.058, 0.95, 14), 0, 0.014), 0.010, 16, 0.74), cloth);
    p.add(xf(new THREE.CylinderGeometry(0.142, 0.128, 0.07, 12), 0, -0.028), rubber);
    p.add(xf(new THREE.TorusGeometry(0.140, 0.020, 5, 14).rotateX(Math.PI / 2), 0, -0.058), steel);
    const palm = new THREE.CapsuleGeometry(0.096, 0.08, 5, 10);
    palm.scale(1, 1, 0.78);
    p.add(xf(palm, 0, -0.125, 0.01), rubber);
    for (let i = 0; i < 4; i++) {                            // curled fingers
      const fx = (-1.5 + i) * 0.048, bend = 0.55 + i * 0.08;
      p.add(xf(new THREE.CapsuleGeometry(0.026, 0.075, 3, 6), fx, -0.222, 0.028, bend), rubber);
      p.add(xf(new THREE.CapsuleGeometry(0.024, 0.055, 3, 6), fx, -0.252, 0.088, bend + 0.75), rubber);
      p.add(xf(new THREE.SphereGeometry(0.021, 5, 4), fx, -0.238, 0.062), darkLeather);   // knuckle
    }
    p.add(xf(new THREE.CapsuleGeometry(0.031, 0.07, 3, 6), s * 0.088, -0.175, 0.05, 0.5, 0, s * 0.7), rubber);
    p.bake();
  }

  // boots: blue sock cuff + white band, leather upper, dark toe cap and heel, thick sole
  for (const leg of [g.legR, g.legL]) {
    const p = Part(leg.end);
    p.add(fold(xf(band(0.192, 0.13, 0.95, 14), 0, -0.028), 0.012, 15, 0.74), cloth);
    p.add(xf(band(0.197, 0.048, 0.95, 14), 0, 0.052), trim);
    p.add(xf(new THREE.CylinderGeometry(0.185, 0.168, 0.14, 12), 0, -0.135), leather);
    p.add(xf(new THREE.TorusGeometry(0.186, 0.024, 5, 14).rotateX(Math.PI / 2), 0, -0.072), darkLeather);
    p.add(xf(new THREE.BoxGeometry(0.212, 0.20, 0.40), 0, -0.225, 0.045), leather);
    for (let i = 0; i < 4; i++) {                            // laces over the instep
      p.add(xf(new THREE.CylinderGeometry(0.011, 0.011, 0.20, 5).rotateZ(Math.PI / 2), 0, -0.160 + i * 0.012, 0.05 + i * 0.055, 0.28, 0, 0), darkLeather);
      p.add(xf(new THREE.SphereGeometry(0.016, 5, 4), 0.10, -0.160 + i * 0.012, 0.05 + i * 0.055), brass);
      p.add(xf(new THREE.SphereGeometry(0.016, 5, 4), -0.10, -0.160 + i * 0.012, 0.05 + i * 0.055), brass);
    }
    p.add(xf(new THREE.BoxGeometry(0.238, 0.055, 0.075), 0, -0.245, 0.10), darkLeather);   // instep strap
    p.add(xf(new THREE.BoxGeometry(0.06, 0.045, 0.02), 0.115, -0.245, 0.10), brass);
    const toe = new THREE.SphereGeometry(0.115, 12, 8, 0, TAU, 0, Math.PI / 2);
    toe.scale(0.95, 1.0, 1.25);
    p.add(xf(toe, 0, -0.290, 0.20, Math.PI / 2), steel);                                  // dark metal toe cap
    p.add(xf(new THREE.BoxGeometry(0.245, 0.075, 0.44), 0, -0.328, 0.05), rubber);         // thick sole
    p.add(xf(new THREE.BoxGeometry(0.255, 0.05, 0.13), 0, -0.300, -0.145), steel);         // heel
    rivetRing(p, brass, 10, 0.115, -0.328, 0.017, 1.9);
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
  yaw: curve([[0, .175], [.25, .04], [.50, -.175], [.75, -.04]])
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

function poseWalk(o, p, a, t) {
  const idle = 1 - a;                                        // at a standstill every cyclic term falls away
  o[CH.bobY] = W.bob(p) * a + Math.sin(t * 1.15) * 0.014 * idle;
  o[CH.shiftX] = W.sway(p) * a + Math.sin(t * 0.47) * 0.028 * idle;
  o[CH.shiftZ] = 0;
  o[CH.pYaw] = W.yaw(p) * a;
  o[CH.pRoll] = W.list(p) * a + Math.sin(t * 0.47) * 0.032 * idle;
  o[CH.pPitch] = 0;
  o[CH.sYaw] = -1.5 * W.yaw(p - 0.06) * a;
  o[CH.sPitch] = -(0.07 + 0.11 * a) + Math.sin(t * 1.15 + 0.6) * 0.022 * idle;
  o[CH.sRoll] = -0.6 * W.list(p - 0.04) * a;
  o[CH.nYaw] = 0; o[CH.nPitch] = 0.05 * a;
  o[CH.Rhx] = -W.hip(p) * a; o[CH.Rhz] = 0.075;
  o[CH.Rk] = W.knee(p) * a + 0.07 * idle; o[CH.Ra] = W.ankle(p) * a;
  o[CH.Lhx] = -W.hip(p + 0.5) * a; o[CH.Lhz] = 0.075;
  o[CH.Lk] = W.knee(p + 0.5) * a + 0.07 * idle; o[CH.La] = W.ankle(p + 0.5) * a;
  // arms swing against the same-side leg with a lag; the lantern arm is damped
  const ra = -W.hip(p - 0.08) * a, la = -W.hip(p + 0.42) * a;
  o[CH.Rsx] = -ra * 0.34 - 0.10; o[CH.Rsz] = 0.18; o[CH.Rsy] = -0.10;
  o[CH.Re] = -(0.44 + Math.max(0, -ra) * 0.35);
  o[CH.Lsx] = -la * 0.62; o[CH.Lsz] = 0.15; o[CH.Lsy] = 0.05;
  o[CH.Le] = -(0.20 + Math.max(0, -la) * 0.5);
}

function poseSwim(o, p, t, drive) {
  o[CH.bobY] = Math.sin(t * 0.9) * 0.035;
  o[CH.shiftX] = Math.sin(t * 0.62) * 0.03;
  o[CH.shiftZ] = 0;
  o[CH.pYaw] = Math.sin(t * 0.5) * 0.05;
  o[CH.pRoll] = Math.sin(t * 0.71) * 0.06;
  o[CH.pPitch] = -0.10 - S.hip(p) * 0.10;
  o[CH.sYaw] = Math.sin(t * 0.44 + 1) * 0.07;
  o[CH.sPitch] = 0.10 + S.hip(p) * 0.06;
  o[CH.sRoll] = Math.sin(t * 0.58) * 0.07;
  o[CH.nYaw] = Math.sin(t * 0.33) * 0.06; o[CH.nPitch] = -0.06;
  const k = 0.45 + 0.55 * drive;
  o[CH.Rhx] = -S.hip(p) * k; o[CH.Rhz] = 0.06 + S.abd(p) * k;
  o[CH.Rk] = S.knee(p) * k; o[CH.Ra] = S.ankle(p) * k;
  o[CH.Lhx] = -S.hip(p + 0.03) * k; o[CH.Lhz] = 0.06 + S.abd(p + 0.03) * k;   // slight asymmetry
  o[CH.Lk] = S.knee(p + 0.03) * k; o[CH.La] = S.ankle(p + 0.03) * k;
  o[CH.Rsx] = -0.42 - Math.sin(t * 0.8) * 0.10; o[CH.Rsz] = 0.34; o[CH.Rsy] = -0.22;
  o[CH.Re] = -(0.85 + Math.sin(t * 0.8 + 0.6) * 0.10);
  o[CH.Lsx] = -0.22 + Math.sin(t * 0.66 + 2) * 0.30; o[CH.Lsz] = 0.42 + Math.sin(t * 0.5) * 0.10; o[CH.Lsy] = 0.18;
  o[CH.Le] = -(0.55 + Math.sin(t * 0.66 + 1.2) * 0.28);
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
let walkP = 0, swimP = 0, gb = 0, yawF = 0, yawInit = false;
const sPitch = { x: 0, v: 0 }, sRollT = { x: 0, v: 0 };

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

  gb = lerp(gb, player.grounded ? 1 : 0, Math.min(1, 4.5 * dt));

  // stride advances with distance travelled, capped so a boosted sprint doesn't turn into a scurry
  const stepRate = clamp(flat / 2.35, 0, 2.1);
  walkP = (walkP + stepRate * dt) % 1;
  swimP = (swimP + (0.24 + speed * 0.028) * dt) % 1;

  const amp = clamp(flat * 0.42 - 0.06, 0, 1);
  poseWalk(pw, walkP, amp, t);
  poseSwim(psw, swimP, t, clamp(speed * 0.09, 0, 1));
  for (let i = 0; i < CH.N; i++) po[i] = psw[i] + (pw[i] - psw[i]) * gb;

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
    settle.v -= 1.9 * gb * amp;
    // Audio keys off the same event that drops the visual weight, so boot sounds can
    // never drift from the animation no matter how the gait is retimed.
    if (gb > 0.5 && amp > 0.08) steps++;
  }
  spring(settle, 0, dt, 11, 0.34);

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
  spring(sRollT, (1 - gb) * clamp(-(player.yaw - yawF) * 2.2, -0.5, 0.5), dt, 4, 0.8);
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
  R.mid.rotation.x = po[CH.Rk]; R.end.rotation.x = po[CH.Ra];
  L.root.rotation.set(po[CH.Lhx], 0, po[CH.Lhz]);
  L.mid.rotation.x = po[CH.Lk]; L.end.rotation.x = po[CH.La];

  const AR = diver.armR, AL = diver.armL;
  AR.root.rotation.set(po[CH.Rsx], po[CH.Rsy], -po[CH.Rsz]);
  AR.mid.rotation.x = po[CH.Re];
  AL.root.rotation.set(po[CH.Lsx], po[CH.Lsy], po[CH.Lsz]);
  AL.mid.rotation.x = po[CH.Le];

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
