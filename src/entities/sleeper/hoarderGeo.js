// ORUNE, THE HOARDER — geometry and baked maps (roadmap/three-sleepers.md, zone 1).
// Pure: unit scale (mantle radius Rm = 1), +Z is her face, +Y up, seeded, no scene.
// hoarder.js scales the body by Rm and rebuilds the arms (world-space tubes) per frame.
import * as THREE from 'three';
import { canvas2d, toTexture, normalFromHeight, seededRand } from '../../lib/textures.js';

const TAU = Math.PI * 2;
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function lattice(n, rnd) { const g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = rnd(); return { n, g }; }
function vsmp(L, x, y) {
  const n = L.n, g = L.g;
  x = (x % 1 + 1) % 1 * n; y = (y % 1 + 1) % 1 * n;
  const xi = Math.floor(x), yi = Math.floor(y), x1 = (xi + 1) % n, y1 = (yi + 1) % n;
  let tx = x - xi, ty = y - yi;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const a = g[yi * n + xi], b = g[yi * n + x1], c = g[y1 * n + xi], d = g[y1 * n + x1];
  return a + (b - a) * tx + (c - a + (a - b + d - c) * tx) * ty;
}
const OCT = (() => { const r = seededRand(0x0C70B05); return [4, 8, 16, 32, 64, 128].map(n => lattice(n, r)); })();
function fbm(x, y, o0 = 0, o1 = 4) {
  let v = 0, a = 0.5, t = 0;
  for (let o = o0; o < o1; o++) { v += vsmp(OCT[o], x, y) * a; t += a; a *= 0.5; }
  return v / t;
}

// ---- the mantle --------------------------------------------------------------------
// A deformed sphere: the head forward (+Z) between two raised eye turrets, the great sac
// swelling back and UP behind it, the whole surface raised in warts and folded in slack
// wrinkles across the sac. Its underside, the arm crown, is left open-ish below the head.
export const EYE_AT = [0.52, 0.30, 0.34];                        // turret centre (mirrored in x)
export function mantleGeo(W = 96, H = 72) {
  const g = new THREE.SphereGeometry(1, W, H);
  const p = g.attributes.position, uv = g.attributes.uv;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const back = Math.max(0, -vz);
    let x = vx * 0.78, y = vy * 0.58, z = vz * (vz < 0 ? 1.45 : 0.62);
    y += 0.42 * Math.pow(back, 1.3);                               // the sac rises behind the head
    x *= 1 + 0.22 * back - 0.10 * Math.max(0, vz);                 // broad sac, narrower brow
    y *= 1 + 0.35 * back;
    // eye turrets
    for (const sd of [-1, 1]) {
      const dx = x - EYE_AT[0] * sd, dy = y - EYE_AT[1], dz = z - EYE_AT[2];
      const k = Math.exp(-(dx * dx + dy * dy + dz * dz) / 0.05);
      x += sd * k * 0.10; y += k * 0.14;
    }
    // warts and slack folds (the sac hangs, it is not a balloon)
    const u = uv.getX(i), v = uv.getY(i);
    const wart = sst(0.58, 0.72, fbm(u * 6, v * 5, 2, 6)) * 0.045;
    const fold = Math.sin(v * 38 + fbm(u * 3, v * 3, 0, 3) * 6) * 0.018 * sst(0.1, 0.8, back);
    const n = 1 + wart + fold;
    x *= n; y *= n; z *= n;
    if (vy < -0.55) y = -0.55 * 0.58 + (y + 0.55 * 0.58) * 0.35;   // flattened crown underneath
    p.setXYZ(i, x, y, z);
    const pale = sst(-0.1, -0.5, vy);                               // pale below, like a real octopus
    const c = 0.85 + 0.15 * (1 - wart / 0.045);
    col[i * 3] = c + 0.35 * pale; col[i * 3 + 1] = c + 0.30 * pale; col[i * 3 + 2] = c + 0.28 * pale;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// Chromatophore skin: a field of pigment cells (dark aubergine to bruise-brown), paler
// between them, freckled with iridophore flecks; tileable over the sphere UV.
let _skin = null;
export function skinMaps(S = 512) {
  if (_skin) return _skin;
  const A = canvas2d(S), H = canvas2d(S), E = canvas2d(S);
  const ai = A.ctx.createImageData(S, S), hi = H.ctx.createImageData(S, S), ei = E.ctx.createImageData(S, S);
  const rnd = seededRand(0xC4A0);
  const cells = Array.from({ length: 220 }, () => [rnd(), rnd(), 0.6 + 0.4 * rnd()]);
  const D0 = [0.20, 0.11, 0.16], D1 = [0.30, 0.17, 0.13], P0 = [0.46, 0.36, 0.38], FL = [0.62, 0.66, 0.70];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = (y * S + x) * 4;
    let f1 = 9, f2 = 9, tone = 0;
    for (const [cx, cy, t] of cells) {
      let dx = Math.abs(u - cx); dx = Math.min(dx, 1 - dx);
      let dy = Math.abs(v - cy); dy = Math.min(dy, 1 - dy);
      const d = dx * dx + dy * dy;
      if (d < f1) { f2 = f1; f1 = d; tone = t; } else if (d < f2) f2 = d;
    }
    const edge = sst(0.0, 0.004, Math.sqrt(f2) - Math.sqrt(f1));
    const m = fbm(u * 3, v * 3, 0, 5), fleck = sst(0.80, 0.84, fbm(u * 18, v * 18, 3, 6));
    for (let k = 0; k < 3; k++) {
      let c = D0[k] + (D1[k] - D0[k]) * m;
      c *= tone;
      c += (P0[k] - c) * (1 - edge) * 0.55;                         // pale seams between cells
      c += (FL[k] - c) * fleck * 0.5;
      ai.data[i + k] = Math.max(0, Math.min(255, c * 255));
    }
    ai.data[i + 3] = 255;
    const h = 0.55 * edge + 0.25 * m + 0.15 * fleck;
    hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = h * 255; hi.data[i + 3] = 255;
    // photophore freckles: sparse dots, brightest at the heart of the pigment cells
    const ph = sst(0.86, 0.90, fbm(u * 24 + 0.3, v * 24 + 0.7, 3, 6)) * sst(0.0, 0.004, Math.sqrt(f2) - Math.sqrt(f1));
    ei.data[i] = ei.data[i + 1] = ei.data[i + 2] = ph * 255; ei.data[i + 3] = 255;
  }
  A.ctx.putImageData(ai, 0, 0); H.ctx.putImageData(hi, 0, 0); E.ctx.putImageData(ei, 0, 0);
  _skin = { map: toTexture(A.canvas, 1, true), normalMap: toTexture(normalFromHeight(H.canvas, 2.4)), emissiveMap: toTexture(E.canvas, 1, true) };
  return _skin;
}

// The eye: a wet gold iris with a horizontal slit pupil, painted on a sphere cap facing +Z.
let _eyeTex = null;
export function eyeTex(S = 256) {
  if (_eyeTex) return _eyeTex;
  const { canvas, ctx } = canvas2d(S);
  // Sphere UV: u around (seam at -X), v pole to pole; +Z sits at u = 0.25... draw by uv
  const im = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = (y * S + x) * 4;
    const th = u * TAU, ph = v * Math.PI;
    const dx = -Math.cos(th) * Math.sin(ph), dy = Math.cos(ph), dz = Math.sin(th) * Math.sin(ph);
    // angle from the +Z pole of the eye
    const a = Math.acos(Math.max(-1, Math.min(1, dz)));
    let r = 0.05, g = 0.045, b = 0.04;
    if (a < 0.95) {                                                  // iris
      const k = a / 0.95, ring = 0.5 + 0.5 * Math.sin(Math.atan2(dy, dx) * 40 + k * 12);
      r = 0.62 - 0.30 * k + 0.08 * ring; g = 0.44 - 0.24 * k + 0.05 * ring; b = 0.12;
      // the slit: a horizontal bar, fattest at its middle
      if (Math.abs(dy) < 0.10 * (1 - Math.abs(dx) * 1.2) && a < 0.8) { r = g = b = 0.01; }
    }
    im.data[i] = r * 255; im.data[i + 1] = g * 255; im.data[i + 2] = b * 255; im.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  _eyeTex = toTexture(canvas, 1, true);
  _eyeTex.wrapS = _eyeTex.wrapT = THREE.ClampToEdgeWrapping;
  return _eyeTex;
}

// A sucker: a shallow cup with a raised rim, facing +Y.
export function suckerGeo() {
  const P = [[0.0, -0.02], [0.35, -0.03], [0.70, 0.02], [0.92, 0.10], [1.0, 0.16], [0.95, 0.20], [0.82, 0.18], [0.6, 0.08], [0.0, 0.05]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(P, 14);
  g.computeVertexNormals();
  return g;
}

// A drowned lantern for the hoard: a brass frame, a glass chimney, a ring handle.
export function lanternGeo() {
  const parts = [];
  const add = (geo, x, y, z) => { geo.translate(x, y, z); parts.push(geo); };
  add(new THREE.CylinderGeometry(0.28, 0.32, 0.10, 12), 0, 0.05, 0);          // base
  add(new THREE.CylinderGeometry(0.22, 0.22, 0.55, 12, 1, true), 0, 0.38, 0); // chimney (the glass)
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * TAU + 0.4;
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.60, 5), Math.cos(a) * 0.26, 0.38, Math.sin(a) * 0.26);
  }
  add(new THREE.ConeGeometry(0.30, 0.20, 12), 0, 0.76, 0);                     // cap
  const ring = new THREE.TorusGeometry(0.14, 0.022, 6, 16);
  add(ring, 0, 0.95, 0);
  return mergeAll(parts);
}
function mergeAll(parts) {
  // tiny local merge (no addons import needed for five primitives)
  let nPos = 0, nIdx = 0;
  const geos = parts.map(p => p.index ? p : p.toNonIndexed());
  for (const p of geos) { nPos += p.attributes.position.count; nIdx += p.index ? p.index.count : p.attributes.position.count; }
  const pos = new Float32Array(nPos * 3), nor = new Float32Array(nPos * 3), idx = [];
  let o = 0;
  for (const p of geos) {
    if (!p.attributes.normal) p.computeVertexNormals();
    pos.set(p.attributes.position.array, o * 3);
    nor.set(p.attributes.normal.array, o * 3);
    if (p.index) for (let k = 0; k < p.index.count; k++) idx.push(p.index.array[k] + o);
    else for (let k = 0; k < p.attributes.position.count; k++) idx.push(k + o);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

// Arm tube topology: (rings+1) x (radial+1) grid; positions/normals written per frame.
export function armTubeGeo(rings, radial) {
  const g = new THREE.BufferGeometry();
  const nv = (rings + 1) * (radial + 1);
  const uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
  for (let i = 0; i <= rings; i++) for (let j = 0; j <= radial; j++) {
    const k = i * (radial + 1) + j, a = (j % radial) / radial * TAU;
    uv[k * 2] = i / rings * 6; uv[k * 2 + 1] = j / radial;
    // the underside (the sucker face, -N) is pale; the crest dark
    const pale = sst(0.2, -0.8, Math.cos(a));
    const c = 0.9 + 0.1 * Math.sin(a * 3);
    col[k * 3] = c + 0.45 * pale; col[k * 3 + 1] = c + 0.36 * pale; col[k * 3 + 2] = c + 0.34 * pale;
  }
  const idx = [];
  for (let i = 0; i < rings; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  g.userData.rings = rings; g.userData.radial = radial;
  return g;
}
