// THE BROODER — geometry and baked maps (roadmap/three-sleepers.md, spec §2 zone 0).
// Pure: unit scale (carapace half-width R = 1), +Z is the front, +Y up, seeded, no
// scene access. brooder.js scales the body group by R and poses the parts.
//
// The shell is a crab carapace read as armour: a dome over a lobed footprint (flat
// frontal margin, the eye orbits, a "pie-crust" of scallops down the front flanks),
// the anatomical swellings every crab has (gastric, branchial, cardiac) cut by the
// cervical groove, and over that a mirrored Voronoi of 26 scutes with chamfered seams
// and growth lines. The same function feeds the mesh, the baked maps, the barnacle
// scatter and the ward/collision placement, so they can never disagree.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvas2d, toTexture, normalFromHeight, noiseCanvas, seededRand } from '../../lib/textures.js';

const TAU = Math.PI * 2;
// JS smoothstep; reversed edges are fine HERE (the GLSL UB rule is about the driver).
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (x, w) => Math.exp(-(x / w) * (x / w));

// ---- seeded value noise ------------------------------------------------------------
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
const OCT = (() => { const r = seededRand(0xC4A8A9E5); return [4, 8, 16, 32, 64, 128].map(n => lattice(n, r)); })();
function fbm(x, y, o0 = 0, o1 = 4) {
  let v = 0, a = 0.5, t = 0;
  for (let o = o0; o < o1; o++) { v += vsmp(OCT[o], x, y) * a; t += a; a *= 0.5; }
  return v / t;
}

// ---- footprint ---------------------------------------------------------------------
export function rimR(th) {
  // A shield, not a pie (Michael 2026-09-24: "crab like, menacing" — the round
  // scalloped dome read as a literal, friendly crab). Widest across the front
  // shoulders, tapering hard to the rear, a straight brow across the face, and a
  // fine jagged serration all round instead of scallops. The big spikes are thorn
  // instances (thornMatrices), not footprint wiggles.
  const c = Math.cos(th), s = Math.sin(th);
  let r = 1 / Math.sqrt(c * c + (s / 1.02) * (s / 1.02));
  if (s < 0) r *= 1 - 0.34 * Math.pow(-s, 1.3);                   // tapers to the rear
  if (s > 0) r *= 1 + 0.06 * Math.pow(s, 0.8) * (1 - s * s) * 4;   // heavy front shoulders
  if (s > 0) r = Math.min(r, 0.92 / Math.max(s, 1e-3));            // the brow
  r *= 1 + 0.018 * Math.pow(Math.abs(Math.sin(th * 23)), 6);       // jagged margin
  if (s > 0) r -= 0.035 * gauss(c, 0.06) * s;                      // rostral notch
  return r;
}

// 26 scutes: four on the keel, eleven mirrored pairs down the flanks.
const PLATES = (() => {
  const rnd = seededRand(0xB700D5E7), pts = [];
  for (const z of [0.52, 0.18, -0.16, -0.48]) pts.push([0, z + (rnd() - 0.5) * 0.06]);
  const flank = [[0.34, 0.56], [0.38, 0.26], [0.36, -0.06], [0.34, -0.36], [0.66, 0.40], [0.70, 0.10],
    [0.66, -0.20], [0.56, -0.50], [0.90, 0.22], [0.90, -0.06], [0.80, -0.34]];
  for (const [x, z] of flank) {
    const jx = (rnd() - 0.5) * 0.08, jz = (rnd() - 0.5) * 0.08;
    pts.push([x + jx, z + jz], [-(x + jx), z + jz]);
  }
  return pts;
})();

export function shellAt(x, z, out) {
  const rr = rimR(Math.atan2(z, x)), rho = Math.min(1, Math.hypot(x, z) / rr);
  let f1 = 9, f2 = 9, id = 0;
  for (let i = 0; i < PLATES.length; i++) {
    const dx = x - PLATES[i][0], dz = z - PLATES[i][1], d = dx * dx + dz * dz;
    if (d < f1) { f2 = f1; f1 = d; id = i; } else if (d < f2) f2 = d;
  }
  f1 = Math.sqrt(f1); f2 = Math.sqrt(f2);
  const d = f2 - f1, inner = 1 - sst(0.86, 0.985, rho);           // scutes fade into the margin
  // hunched: the mass rides forward over the face, the back falls away
  let h = 0.50 * Math.pow(Math.max(0, 1 - Math.pow(rho, 2.2)), 0.55) * (0.78 + 0.34 * sst(-0.7, 0.35, z));
  h += 0.045 * Math.exp(-(x * x + (z - 0.34) * (z - 0.34)) / 0.07);                        // gastric
  h += 0.035 * (Math.exp(-((x - 0.46) * (x - 0.46) + (z + 0.04) * (z + 0.04)) / 0.09)
              + Math.exp(-((x + 0.46) * (x + 0.46) + (z + 0.04) * (z + 0.04)) / 0.09));   // branchial
  h += 0.030 * Math.exp(-(x * x + (z + 0.30) * (z + 0.30)) / 0.03);                        // cardiac
  h -= 0.020 * gauss(z - (0.08 + 0.35 * x * x), 0.03) * inner;                              // cervical groove
  h += 0.070 * gauss(x, 0.055) * (1 - rho * rho);                                            // keel ridge
  h -= 0.022 * (1 - sst(0.0, 0.035, d)) * inner;                                             // scute seams
  h += 0.018 * sst(0.02, 0.16, d) * inner;                                                   // scute crowns
  out.h = h; out.rho = rho; out.d = d; out.id = id; out.f1 = f1;
  return out;
}

const _s1 = {}, _s2 = {};
export function shellNormal(x, z, out) {
  const e = 0.004;
  const hx = (shellAt(x + e, z, _s1).h - shellAt(x - e, z, _s2).h) / (2 * e);
  const hz = (shellAt(x, z + e, _s1).h - shellAt(x, z - e, _s2).h) / (2 * e);
  return out.set(-hx, 1, -hz).normalize();
}

function withColor(g, r, gg, b) {
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gg; c[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function build(pos, uv, col, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---- carapace ----------------------------------------------------------------------
// Polar grid: ROWS from the crown to the rim, then RIM rows curling under to the lip at
// rho 0.80. The wrap column duplicates column 0; its normals are averaged after the
// solve so the +X flank has no seam. Planar UVs (x,z)*0.5+0.5 carry the baked maps.
export function carapaceGeo(COLS = 256, ROWS = 88, RIM = 14) {
  const sh = {}, pos = [], uv = [], col = [], idx = [];
  const NR = ROWS + RIM;
  for (let i = 0; i <= NR; i++) for (let j = 0; j <= COLS; j++) {
    const th = (j % COLS) / COLS * TAU, rr = rimR(th), c = Math.cos(th), s = Math.sin(th);
    let x, y, z, shade = 1;
    if (i <= ROWS) {
      const rho = 0.004 + 0.996 * Math.pow(i / ROWS, 0.85);
      x = c * rr * rho; z = s * rr * rho; y = shellAt(x, z, sh).h;
    } else {
      const k = (i - ROWS) / RIM;
      // across the front the margin hangs as a visor that shadows the eyes
      const front = Math.pow(Math.max(0, s), 4);
      const rho = 1 + 0.018 * Math.sin(k * Math.PI) - (0.20 - 0.12 * front) * sst(0.25, 1, k);
      const yE = shellAt(c * rr * 0.9999, s * rr * 0.9999, sh).h;
      x = c * rr * rho; z = s * rr * rho;
      y = yE * (1 - k) - (0.085 + 0.17 * front) * Math.sin(k * Math.PI / 2);
      shade = 1 - 0.42 * k;                                        // the lip's underside is in its own shade
    }
    pos.push(x, y, z); uv.push(x * 0.5 + 0.5, z * 0.5 + 0.5); col.push(shade, shade, shade);
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < COLS; j++) {
    const a = i * (COLS + 1) + j, b = a + COLS + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);                        // faces up/out
  }
  const g = build(pos, uv, col, idx);
  const n = g.attributes.normal;
  for (let i = 0; i <= NR; i++) {
    const a = i * (COLS + 1), b = a + COLS;
    const nx = n.getX(a) + n.getX(b), ny = n.getY(a) + n.getY(b), nz = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(a, nx / l, ny / l, nz / l); n.setXYZ(b, nx / l, ny / l, nz / l);
  }
  return g;
}

// Baked over the planar UV: pale chalk scutes, weathered toward their seams, black-brown
// seam cavities, growth lines, an olive film pooled in grooves and down the flanks, crust
// speckle, pitting, sediment dusting the rear. Built once per module lifetime.
let _maps = null;
export function carapaceMaps(S = 1024) {
  if (_maps) return _maps;
  const sh = {};
  const A = canvas2d(S), Rg = canvas2d(S), H = canvas2d(S);
  const ai = A.ctx.createImageData(S, S), ri = Rg.ctx.createImageData(S, S), hi = H.ctx.createImageData(S, S);
  // Wet near-black armour; each scute's chamfer worn to pale bone just inside its seam;
  // black seams; a dark olive film; bone-white crust. The crowns stay wet (low rough).
  const C0 = [0.150, 0.145, 0.135], C1 = [0.50, 0.46, 0.39], C2 = [0.030, 0.026, 0.022];
  const C3 = [0.13, 0.15, 0.09], C4 = [0.70, 0.67, 0.60], SAND = [0.42, 0.39, 0.33];
  for (let py = 0; py < S; py++) {
    const z = 1 - 2 * (py + 0.5) / S, v = z * 0.5 + 0.5;
    for (let px = 0; px < S; px++) {
      const x = 2 * (px + 0.5) / S - 1, u = x * 0.5 + 0.5, i = (py * S + px) * 4;
      shellAt(x, z, sh);
      const tone = 0.85 + 0.30 * ((sh.id * 0.618034) % 1);
      const seam = 1 - sst(0.0, 0.020, sh.d);
      const edge = sst(0.012, 0.035, sh.d) * (1 - sst(0.045, 0.10, sh.d));      // the worn chamfer
      const mott = fbm(u * 2.0, v * 2.0, 1, 5);
      const film = sst(0.55, 0.72, fbm(u * 1.3 + 0.37, v * 1.3 + 0.11, 0, 4)) * (0.35 + 0.65 * sst(0.45, 1.0, sh.rho));
      const crust = sst(0.72, 0.77, fbm(u * 6.0, v * 6.0, 2, 6));
      const pits = sst(0.64, 0.70, fbm(u * 11 + 0.5, v * 11 + 0.5, 3, 6));
      const scars = sst(0.80, 0.83, fbm(u * 3.2 + 0.2, v * 9 + 0.6, 1, 5));    // old gouges
      const rings = 0.5 + 0.5 * Math.sin(sh.f1 * 150 + mott * 3);
      for (let k = 0; k < 3; k++) {
        let cv = C0[k] * tone * (0.80 + 0.40 * mott) * (1 - 0.10 * rings);
        cv += (C1[k] - cv) * (edge * (0.45 + 0.35 * mott) + scars * 0.55);
        cv += (C3[k] - cv) * film * 0.6;
        cv += (C4[k] - cv) * crust * 0.60;
        cv += (SAND[k] - cv) * 0.30 * sst(-0.15, -0.85, z);
        cv += (C2[k] - cv) * seam * 0.95;
        cv *= 1 - 0.40 * pits;
        ai.data[i + k] = Math.max(0, Math.min(255, cv * 255));
      }
      ai.data[i + 3] = 255;
      const rough = Math.min(1, 0.40 + 0.45 * seam + 0.30 * film + 0.40 * crust + 0.25 * pits + 0.2 * edge);
      ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = rough * 255; ri.data[i + 3] = 255;
      const ht = 0.5 + 0.30 * sst(0.02, 0.16, sh.d) - 0.50 * seam + 0.06 * rings
        + 0.10 * crust - 0.25 * pits - 0.20 * scars + 0.08 * (mott - 0.5);
      hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = Math.max(0, Math.min(255, ht * 255)); hi.data[i + 3] = 255;
    }
  }
  A.ctx.putImageData(ai, 0, 0); Rg.ctx.putImageData(ri, 0, 0); H.ctx.putImageData(hi, 0, 0);
  _maps = {
    map: toTexture(A.canvas, 1, true),
    roughnessMap: toTexture(Rg.canvas),
    normalMap: toTexture(normalFromHeight(H.canvas, 2.2))
  };
  for (const k in _maps) _maps[k].wrapS = _maps[k].wrapT = THREE.ClampToEdgeWrapping;
  return _maps;
}

// ---- belly + brood apron -------------------------------------------------------------
export function bellyGeo(COLS = 160, ROWS = 48) {
  const pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i <= ROWS; i++) for (let j = 0; j <= COLS; j++) {
    const th = (j % COLS) / COLS * TAU, rho = 0.002 + 0.998 * i / ROWS, rr = rimR(th) * 0.80;
    const x = Math.cos(th) * rr * rho, z = Math.sin(th) * rr * rho;
    let y = -0.075 - 0.035 * (1 - rho * rho);
    for (const zk of [0.40, 0.18, -0.04, -0.26]) y += 0.016 * gauss(z - zk, 0.016) * (1 - 0.6 * rho);   // sternite sutures
    y += 0.012 * gauss(x, 0.018) * (1 - rho);                                                     // median suture
    y -= 0.006 * sst(0.55, 0.75, fbm(x * 0.8 + 0.5, z * 0.8 + 0.5, 1, 4));                        // swollen sternites
    pos.push(x, y, z); uv.push(x * 0.5 + 0.5, z * 0.5 + 0.5);
    const c = 0.62 + 0.10 * rho; col.push(c, c * 0.97, c * 0.92);
  }
  for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
    const a = i * (COLS + 1) + j, b = a + COLS + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);                        // faces down
  }
  const belly = build(pos, uv, col, idx);
  // The brood apron: the broad rounded flap folded under the rear that a brooding crab
  // carries her clutch beneath. Three segment sutures across it.
  const S = 24, T = 16, ap = [], au = [], ac = [], ai = [];
  for (let i = 0; i <= S; i++) for (let j = 0; j <= T; j++) {
    const s = i / S, t = j / T * 2 - 1;
    const z = -0.58 + 0.66 * s;
    const w = 0.36 * Math.pow(Math.sin(Math.PI * (0.15 + 0.85 * s)), 0.5) * (1 - 0.35 * s);
    const x = t * w;
    let y = -0.108 - 0.022 * (1 - t * t);
    for (const sk of [0.28, 0.52, 0.74]) y += 0.006 * gauss(s - sk, 0.02);
    ap.push(x, y, z); au.push(x * 0.5 + 0.5, z * 0.5 + 0.5); ac.push(0.70, 0.67, 0.63);
  }
  for (let i = 0; i < S; i++) for (let j = 0; j < T; j++) {
    const a = i * (T + 1) + j, b = a + T + 1;
    ai.push(a, a + 1, b, b, a + 1, b + 1);                         // faces down
  }
  return mergeGeometries([belly, build(ap, au, ac, ai)]);
}

// ---- limbs ---------------------------------------------------------------------------
// A unit-length exoskeleton segment along +X (0 = proximal joint, 1 = distal). Section
// tall in Y, thin in Z (crab legs are flattened fore-aft), a neck at the socket, condyles
// flaring at the distal joint, a dorsal carina, optional raked spines along the top.
// Vertex colour darkens into both joints; a `tip` segment tapers to a hooked, dark point.
export function segmentGeo({ r0, r1, flat = 0.58, spines = 0, rows = 26, radial = 18, tip = false, curl = 0 }) {
  const pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const s = i / rows;
    let r;
    if (tip) r = r0 * Math.pow(1 - s, 0.75) + 0.002;
    else {
      r = r0 + (r1 - r0) * s;
      // articulation, not plumbing: a pinched neck into the socket and a flared condyle
      // cup at the distal joint, so each segment visibly SEATS in the last
      r *= 1 - 0.28 * gauss(s - 0.035, 0.045);
      r *= 1 + 0.30 * gauss(s - 0.95, 0.055);
      r *= 1 + 0.04 * Math.sin(s * Math.PI);
    }
    const cy = -curl * s * s;
    // the arthrodial membrane: a dark, soft ring in every joint
    // the arthrodial membrane is soft and PALE against the dark armour (colour > 1 lifts
    // the dark albedo); tips darken to horn
    const dark = tip ? 1 - 0.70 * sst(0.35, 1.0, s) : 1 + 2.2 * gauss(s - 0.02, 0.035) - 0.25 * gauss(s - 1, 0.04);
    for (let j = 0; j <= radial; j++) {
      const a = (j % radial) / radial * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const keel = 1 + 0.10 * Math.pow(Math.max(0, ca), 8);
      pos.push(s, cy + ca * r * keel, sa * r * flat);
      uv.push(s, j / radial);
      const c = dark * (0.92 + 0.08 * ca), pk = dark > 1 ? 1 : 0;   // membranes run faintly flesh-toned
      col.push(c, c * (0.96 - 0.10 * pk), c * (0.90 - 0.14 * pk));
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  let g = build(pos, uv, col, idx);
  if (spines) {
    const parts = [g];
    for (let k = 0; k < spines; k++) {
      const s = 0.14 + 0.72 * (k + 0.5) / spines, r = r0 + (r1 - r0) * s;
      // stubby, broad-based tubercles raked hard toward the tip (thin cones read as nails)
      const cone = new THREE.ConeGeometry(r * 0.30, r * 0.55, 6);
      cone.translate(0, r * 0.27, 0);
      cone.rotateZ(-0.85);                                          // raked toward the distal end
      cone.translate(s, r * 1.02, 0);
      parts.push(withColor(cone, 2.4, 2.25, 2.0));                  // bone-pale tubercles
    }
    g = mergeGeometries(parts);
  }
  return g;
}

// A curved finger along +X from its hinge, hooking by `curve` (+ up, - down), tapering to
// a dark point. Teeth on the biting edge (`bite` +1 = +Y, -1 = -Y): 'molar' is three
// rounded crushing tubercles, 'saw' nine raked cutting teeth.
export function hornGeo({ len, r0, curve, flat = 0.7, bite = -1, teeth = 'saw', rows = 22, radial = 14 }) {
  const pos = [], uv = [], col = [], idx = [];
  const C = s => [len * s, curve * len * s * s];
  for (let i = 0; i <= rows; i++) {
    const s = i / rows, [cx, cy] = C(s);
    const tx = len, ty = 2 * curve * len * s, tl = Math.hypot(tx, ty), nx = -ty / tl, ny = tx / tl;
    const r = r0 * Math.pow(1 - s, 0.8) + 0.002, dark = 1 - 0.82 * sst(0.35, 1, s);
    for (let j = 0; j <= radial; j++) {
      const a = (j % radial) / radial * TAU, ca = Math.cos(a), sa = Math.sin(a);
      pos.push(cx + nx * ca * r, cy + ny * ca * r, sa * r * flat);
      uv.push(s, j / radial);
      col.push(dark, dark * 0.93, dark * 0.86);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const parts = [build(pos, uv, col, idx)];
  const at = teeth === 'none' ? [] : teeth === 'molar' ? [0.25, 0.50, 0.72] : Array.from({ length: 9 }, (_, k) => 0.10 + 0.08 * k);
  for (const s of at) {
    const [cx, cy] = C(s), r = r0 * Math.pow(1 - s, 0.8) + 0.002;
    let t;
    if (teeth === 'molar') {
      t = new THREE.SphereGeometry(r * 0.55, 10, 8);
      t.scale(1.3, 0.8, 0.9);
    } else {
      t = new THREE.ConeGeometry(r * 0.30, r * 0.95, 5);
      t.translate(0, r * 0.47, 0);
      t.rotateZ(-0.5);
      if (bite < 0) t.rotateX(Math.PI);
    }
    t.translate(cx, cy + bite * r * 0.92, 0);
    parts.push(withColor(t, 0.30, 0.27, 0.24));
  }
  return parts.length > 1 ? mergeGeometries(parts) : parts[0];
}

// The claw's hand: a flattened, swollen palm along +X with the fixed finger (pollex)
// growing from its lower distal corner. userData.hinge is where the moving finger pivots.
// 'scythe' is the raptorial arm: a long, slim, keeled hand whose finger folds back
// along it like a mantis blade.
export function palmGeo(kind) {
  const crusher = kind === 'crusher', scythe = kind === 'scythe';
  const len = crusher ? 0.62 : scythe ? 0.95 : 0.74, hgt = crusher ? 0.36 : scythe ? 0.15 : 0.22, wid = crusher ? 0.62 : 0.55;
  const rows = 30, radial = 22, pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const s = i / rows, prof = Math.pow(Math.sin(Math.PI * (0.06 + 0.88 * s)), 0.55);
    for (let j = 0; j <= radial; j++) {
      const a = (j % radial) / radial * TAU, ca = Math.cos(a), sa = Math.sin(a);
      // granular tubercles on the crusher's outer face; the cutter is smooth and keeled
      const gr = crusher ? 1 + 0.04 * sst(0.58, 0.74, fbm(s * 3, j / radial * 3, 2, 5)) : 1 + 0.06 * Math.pow(Math.max(0, ca), 10);
      const r = hgt * 0.5 * prof * gr;
      pos.push(s * len, ca * r, sa * r * wid);
      uv.push(s, j / radial);
      const c = 0.90 + 0.08 * ca;
      col.push(c, c * 0.97, c * 0.92);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const pollex = hornGeo({ len: crusher ? 0.30 : scythe ? 0.16 : 0.44, r0: hgt * 0.28, curve: 0.12, bite: 1, teeth: crusher ? 'molar' : 'saw' });
  pollex.translate(len * 0.88, -hgt * 0.17, 0);
  const g = mergeGeometries([build(pos, uv, col, idx), pollex]);
  g.userData.hinge = [len * 0.90, hgt * 0.20, 0];
  g.userData.len = len;
  return g;
}

// ---- crust ---------------------------------------------------------------------------
// An acorn barnacle: a fluted volcano of six wall plates around a closed operculum.
export function barnacleGeo() {
  const P = [[0.050, 0], [0.053, 0.008], [0.046, 0.024], [0.033, 0.044], [0.022, 0.056],
    [0.017, 0.054], [0.012, 0.044], [0.004, 0.036], [0.0, 0.035]].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(P, 12);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), f = 1 + 0.10 * Math.cos(Math.atan2(z, x) * 6);
    p.setX(i, x * f); p.setZ(i, z * f);
  }
  g.computeVertexNormals();
  return g;
}

const _up = new THREE.Vector3(0, 1, 0), _nn = new THREE.Vector3(), _qq = new THREE.Quaternion(), _qt = new THREE.Quaternion();
const _pp = new THREE.Vector3(), _ss = new THREE.Vector3();
// Barnacles colonise the upper shell in patches, thickest toward the rim and the rear.
export function barnacleMatrices(n, seed) {
  const rnd = seededRand(seed), sh = {}, m = [], c = [];
  let guard = 0;
  while (m.length < n && guard++ < n * 60) {
    const x = rnd() * 2 - 1, z = rnd() * 2 - 1;
    shellAt(x, z, sh);
    if (sh.rho > 0.97 || sh.rho < 0.25) continue;
    const want = sst(0.50, 0.66, fbm(x * 0.9 + 0.5, z * 0.9 + 0.5, 0, 3)) * (0.35 + 0.65 * sst(0.4, 0.95, sh.rho)) * (z < 0 ? 1 : 0.6);
    if (rnd() > want) continue;
    shellNormal(x, z, _nn);
    _qq.setFromUnitVectors(_up, _nn).multiply(_qt.setFromAxisAngle(_up, rnd() * TAU));
    // sized to the scutes, not to the diver: a crust, not a rockpile (look-dev 2026-09-24)
    const k = 0.30 + 0.55 * Math.pow(rnd(), 2.2);
    m.push(new THREE.Matrix4().compose(_pp.set(x, sh.h - 0.004, z), _qq, _ss.set(k, k * (0.8 + 0.4 * rnd()), k)));
    const t = 0.84 + 0.14 * rnd();
    c.push(new THREE.Color(t, t * 0.98, t * 0.93));
  }
  return { m, c };
}

// Weed tufts: the rear margin and the flank edges, leaning outward.
export function weedMatrices(n, seed) {
  const rnd = seededRand(seed), sh = {}, m = [];
  let guard = 0;
  while (m.length < n && guard++ < n * 60) {
    const th = rnd() * TAU, rho = 0.80 + 0.17 * rnd();
    if (Math.sin(th) > 0.25 && rnd() > 0.2) continue;
    const rr = rimR(th), x = Math.cos(th) * rr * rho, z = Math.sin(th) * rr * rho;
    shellAt(x, z, sh);
    shellNormal(x, z, _nn);
    _nn.x += Math.cos(th) * 0.5; _nn.z += Math.sin(th) * 0.5; _nn.normalize();
    _qq.setFromUnitVectors(_up, _nn).multiply(_qt.setFromAxisAngle(_up, rnd() * TAU));
    const k = 0.6 + 0.9 * rnd();
    m.push(new THREE.Matrix4().compose(_pp.set(x, sh.h - 0.003, z), _qq, _ss.set(k, k, k)));
  }
  return m;
}

// Limb albedo: tileable mottle with pitting and a faint olive film. `pale` is the
// underbelly: the colour of something that never sees light.
const _limbAlb = {};
export function limbAlbedo(pale = false, S = 256) {
  const key = pale ? 'p' : 'd';
  if (_limbAlb[key]) return _limbAlb[key];
  const { canvas, ctx } = canvas2d(S), im = ctx.createImageData(S, S);
  const B = pale ? [0.58, 0.54, 0.47] : [0.17, 0.16, 0.15];
  const D = pale ? [0.40, 0.36, 0.31] : [0.07, 0.066, 0.06];
  const F = pale ? [0.45, 0.46, 0.36] : [0.12, 0.14, 0.09];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = (y * S + x) * 4;
    const m = fbm(u, v, 0, 5), pit = sst(0.64, 0.70, fbm(u * 4, v * 4, 2, 6)), film = sst(0.55, 0.72, fbm(u + 0.3, v + 0.7, 0, 3));
    for (let k = 0; k < 3; k++) {
      let c = B[k] + (D[k] - B[k]) * sst(0.35, 0.75, m) * 0.7;
      c += (F[k] - c) * film * 0.35;
      c *= 1 - 0.45 * pit;
      im.data[i + k] = Math.max(0, Math.min(255, c * 255));
    }
    im.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  const t = toTexture(canvas, 1, true);
  t.repeat.set(3, 1);
  return (_limbAlb[key] = t);
}

// ---- thorns ----------------------------------------------------------------------------
// One unit thorn along +X, hooking up (+Y), bone at the base darkening to horn at the tip.
export function thornGeo() {
  return hornGeo({ len: 1, r0: 0.16, curve: 0.22, flat: 0.8, teeth: 'none', rows: 14, radial: 9 });
}
const _td = new THREE.Vector3(), _tu = new THREE.Vector3(), _tz = new THREE.Vector3(), _tp = new THREE.Vector3();
function thornMat(p, dir, len, out) {
  _td.copy(dir).normalize();
  _tu.set(0, 1, 0);
  if (Math.abs(_td.y) > 0.9) _tu.set(0, 0, -1);
  _tz.crossVectors(_td, _tu).normalize();
  _tu.crossVectors(_tz, _td).normalize();
  out.makeBasis(_td, _tu, _tz).scale(_tp.set(len, len, len)).setPosition(p);
  return out;
}
// The menace in the silhouette: lateral spikes raking back off the shoulders, a row of
// brow spikes over the face, a dorsal ridge of spines, and short thorns on the scute crowns.
export function thornMatrices(seed) {
  const rnd = seededRand(seed), sh = {}, m = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const rimPt = th => { const rr = rimR(th); return V(Math.cos(th) * rr * 0.995, shellAt(Math.cos(th) * rr * 0.99, Math.sin(th) * rr * 0.99, sh).h, Math.sin(th) * rr * 0.995); };
  // lateral: four per side, longest at the shoulder, all raked back and a little up
  const LAT = [[1.05, 0.34], [0.62, 0.30], [0.22, 0.24], [-0.30, 0.18]];
  for (const [th, len] of LAT) for (const sd of [1, -1]) {
    const t = sd > 0 ? th : Math.PI - th, p = rimPt(t);
    m.push(thornMat(p, V(Math.cos(t), 0.30, Math.sin(t) - 0.55), len * (0.9 + 0.2 * rnd()), new THREE.Matrix4()));
  }
  // brow: five across the face, forward and down, the middle pair longest
  for (let k = 0; k < 5; k++) {
    const x = (k - 2) * 0.13, t = Math.atan2(0.92, x), p = rimPt(t);
    p.y -= 0.05;
    m.push(thornMat(p, V(x * 0.6, -0.45, 1), (k === 1 || k === 3 ? 0.20 : 0.15) * (0.9 + 0.2 * rnd()), new THREE.Matrix4()));
  }
  // dorsal ridge: seven up the keel, raked back, shrinking to the rear
  for (let k = 0; k < 7; k++) {
    const z = 0.50 - k * 0.16, h = shellAt(0, z, sh).h;
    m.push(thornMat(V(0, h - 0.01, z), V(0, 1, -0.6), (0.20 - k * 0.018) * (0.9 + 0.2 * rnd()), new THREE.Matrix4()));
  }
  // crown thorns on the scutes
  let guard = 0;
  const n0 = m.length;
  while (m.length < n0 + 40 && guard++ < 4000) {
    const x = rnd() * 2 - 1, z = rnd() * 2 - 1;
    shellAt(x, z, sh);
    if (sh.rho > 0.9 || sh.d < 0.10) continue;
    shellNormal(x, z, _nn);
    _nn.z -= 0.5;
    m.push(thornMat(V(x, sh.h - 0.005, z), _nn, 0.05 + 0.06 * rnd(), new THREE.Matrix4()));
  }
  return m;
}

let _grain = null;
export function limbGrain() {
  if (_grain) return _grain;
  _grain = toTexture(normalFromHeight(noiseCanvas(256, 5, 1.3, seededRand(0x6A1F00D5)), 3));
  _grain.repeat.set(6, 2);
  return _grain;
}
