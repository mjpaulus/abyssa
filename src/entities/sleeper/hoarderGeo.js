// ORUNE, THE HOARDER — geometry and baked maps (roadmap/three-sleepers.md, zone 1).
// Pure: unit scale (mantle radius Rm = 1), +Z is her face, +Y up, seeded, no scene.
// hoarder.js scales the body by Rm and rebuilds the arms (world-space tubes) per frame.
//
// polish-sleepers2 (2026-09-25, "lots of things just look like primitives"): the skin is a
// float-height DataTexture bake (chromatophore cells with relief, papillae, lensed
// photophores, iridophore flecks packed into the roughness map's R for a grazing-angle
// term, a wet roughness), the mantle carries real warts, slack creases and a siphon, the
// arm tube is a flattened oral face with a dorsal ridge (hoarder.js), suckers are stalked
// cups, the eye is a domed gold iris under fleshy lids, and the hoard's lanterns, crate
// and ship's lamp are built pieces. The bake kit here (tables, voronoi, DataTexture,
// normals) is exported for hunter.js so Mhor's maps share one idiom.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seededRand, maxAniso } from '../../lib/textures.js';

const TAU = Math.PI * 2;
// JS smoothstep; reversed edges are fine HERE (the GLSL UB rule is about the driver).
export const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

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
export function fbm(x, y, o0 = 0, o1 = 4) {
  let v = 0, a = 0.5, t = 0;
  for (let o = o0; o < o1; o++) { v += vsmp(OCT[o], x, y) * a; t += a; a *= 0.5; }
  return v / t;
}

// ---- the bake kit ----------------------------------------------------------------------
// Tileable fbm TABLES (a 1M-texel bake costs lookups, not lattice evaluations), a jittered
// grid voronoi that tiles, float height -> tangent normal, mipmapped DataTextures.
function ntable(N, o0, o1, ox, oy) {
  const T = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) T[y * N + x] = fbm(x / N + ox, y / N + oy, o0, o1);
  let lo = 1, hi = 0;
  for (let i = 0; i < T.length; i++) { if (T[i] < lo) lo = T[i]; if (T[i] > hi) hi = T[i]; }
  const k = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < T.length; i++) T[i] = (T[i] - lo) * k;
  return { N, T };
}
export function nt(tb, u, v) {
  const N = tb.N, T = tb.T;
  let x = u * N, y = v * N;
  x -= Math.floor(x / N) * N; y -= Math.floor(y / N) * N;
  const xi = x | 0, yi = y | 0, tx = x - xi, ty = y - yi, x1 = (xi + 1) % N, y1 = (yi + 1) % N;
  const a = T[yi * N + xi], b = T[yi * N + x1], c = T[y1 * N + xi], d = T[y1 * N + x1];
  return a + (b - a) * tx + (c - a + (a - b + d - c) * tx) * ty;
}
let _NT = null;
export function NT() {
  if (!_NT) _NT = { A: ntable(128, 0, 5, 0.0, 0.0), B: ntable(128, 1, 6, 0.37, 0.61), C: ntable(128, 2, 6, 0.73, 0.19) };
  return _NT;
}
export function dataTex(data, W, H, srgb) {
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = maxAniso();
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
// Heights in UV units (du = 1/W), so k = 1 is true relief. Row y is v (no flip).
export function normalsInto(out, Hf, W, H, k, wrap = true) {
  const du = 1 / W, dv = 1 / H;
  for (let y = 0; y < H; y++) {
    const ym = wrap ? (y + H - 1) % H : Math.max(0, y - 1), yp = wrap ? (y + 1) % H : Math.min(H - 1, y + 1);
    for (let x = 0; x < W; x++) {
      const xm = wrap ? (x + W - 1) % W : Math.max(0, x - 1), xp = wrap ? (x + 1) % W : Math.min(W - 1, x + 1);
      const nx = -(Hf[y * W + xp] - Hf[y * W + xm]) / (2 * du) * k;
      const ny = -(Hf[yp * W + x] - Hf[ym * W + x]) / (2 * dv) * k;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + 1), i = (y * W + x) * 4;
      out[i] = (nx * l * 0.5 + 0.5) * 255; out[i + 1] = (ny * l * 0.5 + 0.5) * 255; out[i + 2] = (l * 0.5 + 0.5) * 255; out[i + 3] = 255;
    }
  }
}
// Jittered-grid voronoi that tiles on [0,1)^2: nx x ny cells, one seeded point each.
export function cellGrid(nx, ny, seed, jit = 0.9) {
  const r = seededRand(seed), n = nx * ny, px = new Float32Array(n), py = new Float32Array(n), t = new Float32Array(n), q = new Float32Array(n);
  for (let i = 0; i < n; i++) { px[i] = 0.5 + (r() - 0.5) * jit; py[i] = 0.5 + (r() - 0.5) * jit; t[i] = r(); q[i] = r(); }
  return { nx, ny, px, py, t, q };
}
// out: f1, f2 (grid-cell units), id, dx/dy (texel -> nearest point, grid units)
export function voro(G, u, v, out) {
  const x = u * G.nx, y = v * G.ny, ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0, bx = 0, by = 0;
  for (let oy = -1; oy <= 1; oy++) {
    let cy = iy + oy; const wy = ((cy % G.ny) + G.ny) % G.ny;
    for (let ox = -1; ox <= 1; ox++) {
      const cx = ix + ox, wx = ((cx % G.nx) + G.nx) % G.nx, c = wy * G.nx + wx;
      const dx = cx + G.px[c] - x, dy = cy + G.py[c] - y, d = dx * dx + dy * dy;
      if (d < f1) { f2 = f1; f1 = d; id = c; bx = dx; by = dy; } else if (d < f2) f2 = d;
    }
  }
  out.f1 = Math.sqrt(f1); out.f2 = Math.sqrt(f2); out.id = id; out.dx = bx; out.dy = by;
  return out;
}
const hash1 = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// ---- shared shader patches (one program each) -----------------------------------------
// WET SKIN: a lit Fresnel sheen (scaled by the light the texel actually receives, so it is
// never a glow in the dark) plus IRIDOPHORES — flecks packed into the roughness map's R
// that throw a teal-to-violet sheen only at grazing angles.
//
// BIPLANAR (the mantle only, its own program): a sphere's UV pinches at its poles, so the
// mantle carries a second spherical UV about the X axis (uvB) and a weight (wB) that hands
// the two Y-pole caps to it; every map is sampled in both and blended, the normal map in
// both tangent frames.
export function wetSkin(m, key, irid = 1, bi = false) {
  m.customProgramCacheKey = () => key;
  m.onBeforeCompile = sh => {
    const smp = (chunk, tex, uv) => THREE.ShaderChunk[chunk].split(`texture2D( ${tex}, ${uv} )`).join(`mix( texture2D( ${tex}, ${uv} ), texture2D( ${tex}, vUvB ), vWB )`);
    if (bi) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 uvB;\nattribute float wB;\nvarying vec2 vUvB;\nvarying float vWB;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUvB = uvB; vWB = wB;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vUvB;\nvarying float vWB;')
        .replace('#include <map_fragment>', smp('map_fragment', 'map', 'vMapUv'))
        .replace('#include <roughnessmap_fragment>', smp('roughnessmap_fragment', 'roughnessMap', 'vRoughnessMapUv'))
        .replace('#include <emissivemap_fragment>', smp('emissivemap_fragment', 'emissiveMap', 'vEmissiveMapUv'))
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('normal = normalize( tbn * mapN );', `{
            vec3 mapNB = texture2D( normalMap, vUvB ).xyz * 2.0 - 1.0;
            mapNB.xy *= normalScale;
            mat3 tbnB = getTangentFrame( - vViewPosition, normal, vUvB );
            tbnB[0] *= faceDirection; tbnB[1] *= faceDirection;
            normal = normalize( mix( tbn * mapN, tbnB * mapNB, vWB ) );
          }`));
    }
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', /* glsl */`{
        float wsF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        float wsF3 = wsF * wsF * wsF;
        vec3 wsLit = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
        vec3 wsIrr = wsLit / max(diffuseColor.rgb, vec3(0.08));
        #ifdef USE_ROUGHNESSMAP
          float wsIr = ${bi ? 'mix(texture2D(roughnessMap, vRoughnessMapUv).r, texture2D(roughnessMap, vUvB).r, vWB)' : 'texture2D(roughnessMap, vRoughnessMapUv).r'};
        #else
          float wsIr = 0.0;
        #endif
        vec3 wsHue = mix(vec3(0.35, 0.62, 0.95), vec3(0.70, 0.40, 1.00), smoothstep(0.35, 0.95, wsF));
        outgoingLight += wsIrr * wsHue * wsIr * wsF3 * ${(0.40 * irid).toFixed(3)};
        outgoingLight += wsLit * wsF3 * vec3(1.05, 0.95, 1.0) * 0.55;
      }
      #include <opaque_fragment>`);
  };
  return m;
}
// WET EYE: the cornea's Fresnel rim, lit and a little from the environment.
export function wetEye(m) {
  m.customProgramCacheKey = () => 'abyssa-sleeper-eye';
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', /* glsl */`{
        float weF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        float weF4 = weF * weF * weF * weF;
        vec3 weLit = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular;
        outgoingLight += weF4 * (weLit * 2.5 + vec3(0.012, 0.014, 0.016));
      }
      #include <opaque_fragment>`);
  };
  return m;
}

// ---- the skin ------------------------------------------------------------------------------
// One UV unit ~ 6 world units on the mantle and arms (mantleGeo and the arm tube scale
// their UVs to that). At 1024 a texel is ~6 mm. Layers, finest first:
//   CHROMATOPHORES — a dense 96x96 field of small pigment sacs (brown-black, rust, a few
//     ochre), each expanded or shrunk by the large mottle, so the pattern is made of dots
//     the way real cephalopod skin is, and each sac stands a hair proud;
//   CELL RELIEF — a 44x44 voronoi of shallow grooves (the polygonal skin microrelief);
//   a RETICULATE dark net at a coarse scale, and wrinkles in the dark patches;
//   PAPILLAE — raised cones, slightly paler at the tip;
//   LENSED PHOTOPHORES — a clear domed lens with a bright core and a halo (emissive map);
//   IRIDOPHORES — sparse flecks packed into the roughness map's R for the grazing term.
// Roughness (G) is wet: glossy in the grooves and on the lenses, a touch drier on papillae.
// Point features use own-cell lookups (their jitter keeps them inside the cell), so only
// the relief voronoi pays for a 3x3 search.
function ownCell(G, u, v, out) {
  const x = u * G.nx, y = v * G.ny, ix = Math.floor(x), iy = Math.floor(y);
  const c = (((iy % G.ny) + G.ny) % G.ny) * G.nx + (((ix % G.nx) + G.nx) % G.nx);
  const dx = x - ix - G.px[c], dy = y - iy - G.py[c];
  out.id = c; out.d = Math.sqrt(dx * dx + dy * dy);
  return out;
}
let _skin = null;
export function skinMaps(S = 1024) {
  if (_skin) return _skin;
  const t0 = performance.now();
  const { A: TA, B: TB, C: TC } = NT();
  const chrom = cellGrid(96, 96, 0xC4A0, 0.45), rel = cellGrid(44, 44, 0x7E11), net = cellGrid(6, 6, 0x4E7, 0.8);
  const pap = cellGrid(10, 10, 0x9A911, 0.3), phot = cellGrid(11, 11, 0xF070, 0.5), iri = cellGrid(64, 64, 0x1215, 0.5);
  const Hf = new Float32Array(S * S), alb = new Uint8Array(S * S * 4), rgh = new Uint8Array(S * S * 4), emi = new Uint8Array(S * S * 4), nrm = new Uint8Array(S * S * 4);
  const BASE0 = [0.31, 0.18, 0.17], BASE1 = [0.19, 0.10, 0.12], SAC = [[0.07, 0.035, 0.04], [0.28, 0.07, 0.04], [0.42, 0.26, 0.08]];
  const TIP = [0.46, 0.36, 0.33], LENS = [0.34, 0.33, 0.42], RIM = [0.08, 0.04, 0.05];
  const vr = {}, vn = {}, oc = {}, op = {}, oq = {}, oi = {};
  // the coarse reticulate net and the dark patches it bounds: smooth fields, baked at 256
  // and sampled bilinearly (a full-res 3x3 search here was a third of the bake)
  const NR = 256, NETL = new Float32Array(NR * NR), PATCH = new Float32Array(NR * NR);
  for (let y = 0; y < NR; y++) for (let x = 0; x < NR; x++) {
    const u = (x + 0.5) / NR, v = (y + 0.5) / NR, mot = nt(TA, u * 3, v * 3), mot2 = nt(TB, u * 8, v * 8);
    voro(net, u + (mot2 - 0.5) * 0.02, v + (mot - 0.5) * 0.02, vn);
    NETL[y * NR + x] = 1 - sst(0.0, 0.16, vn.f2 - vn.f1);
    PATCH[y * NR + x] = sst(0.35, 0.75, mot) * (0.5 + 0.5 * net.t[vn.id]);
  }
  const bil = (A, u, v) => {
    let x = u * NR - 0.5, y = v * NR - 0.5; x -= Math.floor(x / NR) * NR; y -= Math.floor(y / NR) * NR;
    const xi = x | 0, yi = y | 0, tx = x - xi, ty = y - yi, x1 = (xi + 1) % NR, y1 = (yi + 1) % NR;
    const a = A[yi * NR + xi], b = A[yi * NR + x1], c = A[y1 * NR + xi], d = A[y1 * NR + x1];
    return a + (b - a) * tx + (c - a + (a - b + d - c) * tx) * ty;
  };
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, i = y * S + x, j = i * 4;
      const mot = nt(TA, u * 3, v * 3), mot2 = nt(TB, u * 8, v * 8), grain = nt(TC, u * 64, v * 64), wr = nt(TB, u * 14 + 0.3, v * 4 + 0.1);
      // the coarse reticulate net and the dark patches it bounds
      const netL = bil(NETL, u, v), patch = bil(PATCH, u, v);
      // chromatophores: sacs expanded by the pattern
      ownCell(chrom, u, v, oc);
      const ct = chrom.t[oc.id], expd = 0.08 + 0.34 * Math.min(1, 0.25 + 0.8 * patch + 0.5 * netL + 0.3 * (ct - 0.5));
      const sac = 1 - sst(expd * 0.7, expd, oc.d), sk = chrom.q[oc.id], sc = sk < 0.55 ? SAC[0] : sk < 0.88 ? SAC[1] : SAC[2];
      // relief grooves
      voro(rel, u, v, vr);
      const groove = 1 - sst(0.0, 0.09, vr.f2 - vr.f1);
      // papillae
      ownCell(pap, u, v, op);
      const pr = 0.20 + 0.14 * pap.q[op.id], has = pap.t[op.id] > 0.35 ? 1 : 0;
      const pk = has * Math.max(0, 1 - (op.d / pr) * (op.d / pr)), papH = pk * pk * (1 + 0.8 * pk);
      // photophores
      ownCell(phot, u, v, oq);
      const on = phot.t[oq.id] < 0.40 ? 1 : 0, lr = 0.07 + 0.03 * phot.q[oq.id], ld = oq.d / lr;
      const lens = on * (1 - sst(0.75, 1.0, ld)), lcore = on * (1 - sst(0.0, 0.45, ld)), halo = on * Math.exp(-(ld / 2.2) * (ld / 2.2));
      const lrim = on * sst(0.8, 1.0, ld) * (1 - sst(1.0, 1.3, ld));
      // iridophores
      ownCell(iri, u, v, oi);
      const irf = (iri.t[oi.id] < 0.24 ? 1 : 0) * (1 - sst(0.10, 0.28, oi.d)) * sst(0.3, 0.6, mot2);
      const wrinkle = (1 - Math.abs(Math.sin((u * 22 + v * 3 + wr * 3) * TAU))) * sst(0.45, 0.8, patch);
      Hf[i] = 0.00035 * sac - 0.0007 * groove + 0.0075 * papH + 0.0004 * (grain - 0.5) - 0.0009 * Math.pow(wrinkle, 3) - 0.0004 * netL
        + 0.0016 * lens * Math.sqrt(Math.max(0, 1 - ld * ld)) + 0.0006 * lrim;
      for (let k = 0; k < 3; k++) {
        let c = BASE0[k] + (BASE1[k] - BASE0[k]) * patch;
        c *= 0.88 + 0.24 * mot2;
        c += (sc[k] - c) * sac * (0.35 + 0.45 * patch);
        c *= 1 - 0.22 * netL - 0.15 * groove;
        c *= 0.92 + 0.16 * grain;
        c += (TIP[k] - c) * sst(0.4, 1.0, papH) * 0.35;
        c += (LENS[k] - c) * lens * 0.45;
        c += (RIM[k] - c) * lrim * 0.6;
        alb[j + k] = Math.min(255, Math.max(0, c * 255));
      }
      alb[j + 3] = 255;
      const r = 0.30 - 0.07 * groove + 0.14 * sst(0.4, 1.0, papH) - 0.16 * lens + 0.06 * (grain - 0.5) + 0.04 * sac;
      rgh[j] = Math.min(255, irf * 255); rgh[j + 1] = Math.min(255, Math.max(0.12, r) * 255); rgh[j + 2] = 0; rgh[j + 3] = 255;
      const e = Math.min(1, lcore + 0.30 * halo);
      emi[j] = emi[j + 1] = emi[j + 2] = e * 255; emi[j + 3] = 255;
    }
  }
  normalsInto(nrm, Hf, S, S, 1.0, true);
  _skin = { map: dataTex(alb, S, S, true), normalMap: dataTex(nrm, S, S, false), roughnessMap: dataTex(rgh, S, S, false), emissiveMap: dataTex(emi, S, S, true) };
  _skin.ms = performance.now() - t0;
  return _skin;
}

// ---- the mantle ------------------------------------------------------------------------
// A deformed sphere: the head forward (+Z) between two raised eye turrets, the great sac
// swelling back and UP behind it. On it: ~260 WARTS as real bumps (a seeded field of
// domes displaced along the normal), SLACK CREASES across the sac (sharp valleys, soft
// ridges — the sac hangs, it is not a balloon), and the SIPHON under the left eye.
export const EYE_AT = [0.52, 0.30, 0.34];                        // turret centre (mirrored in x)
export function mantleGeo(W = 128, H = 96) {
  const g = new THREE.SphereGeometry(1, W, H);
  const p = g.attributes.position, uv = g.attributes.uv;
  const col = new Float32Array(p.count * 3), uvB = new Float32Array(p.count * 2), wB = new Float32Array(p.count);
  const rnd = seededRand(0x0A7E5), NW = 260, wc = new Float32Array(NW * 5);
  for (let k = 0; k < NW; k++) {
    let x, y, z;
    do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 1 || x * x + y * y + z * z < 0.05);
    const l = Math.hypot(x, y, z), w = 0.035 + 0.075 * Math.pow(rnd(), 1.6);
    wc[k * 5] = x / l; wc[k * 5 + 1] = y / l; wc[k * 5 + 2] = z / l; wc[k * 5 + 3] = w * w; wc[k * 5 + 4] = w * (0.30 + 0.25 * rnd());
  }
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const back = Math.max(0, -vz);
    let x = vx * 0.78, y = vy * 0.58, z = vz * (vz < 0 ? 1.45 : 0.62);
    y += 0.42 * Math.pow(back, 1.3);                               // the sac rises behind the head
    x *= 1 + 0.22 * back - 0.10 * Math.max(0, vz);                 // broad sac, narrower brow
    y *= 1 + 0.35 * back;
    y -= 0.05 * back * back * Math.max(0, 1 - Math.abs(vx) * 1.5); // it sags along its spine
    let turret = 0;
    for (const sd of [-1, 1]) {
      const dx = x - EYE_AT[0] * sd, dy = y - EYE_AT[1], dz = z - EYE_AT[2];
      const k = Math.exp(-(dx * dx + dy * dy + dz * dz) / 0.05);
      x += sd * k * 0.10; y += k * 0.14; turret = Math.max(turret, k);
    }
    // warts
    let wart = 0;
    if (vy > -0.5) {
      for (let k = 0; k < NW; k++) {
        const o = k * 5, d2 = (vx - wc[o]) ** 2 + (vy - wc[o + 1]) ** 2 + (vz - wc[o + 2]) ** 2;
        if (d2 < wc[o + 3]) { const q = 1 - d2 / wc[o + 3]; wart = Math.max(wart, wc[o + 4] * q * q * (1.2 - 0.2 * q)); }
      }
      wart *= sst(-0.5, -0.2, vy) * (1 - 0.8 * turret);
    }
    // slack creases across the sac, turning round it, warped
    const u = uv.getX(i), v = uv.getY(i);
    const ph = v * 34 + u * 5 + fbm(u * 3, v * 3, 0, 3) * 7;
    const crease = Math.pow(1 - Math.abs(Math.sin(ph)), 4);          // 1 in the valley
    const fold = (0.010 * Math.sin(ph) - 0.020 * crease) * sst(0.05, 0.7, back);
    // the ring of wrinkles round each eye turret
    const rw = turret > 0.05 ? -0.008 * Math.pow(Math.abs(Math.sin(Math.atan2(y - EYE_AT[1], z - EYE_AT[2]) * 9)), 3) * sst(0.08, 0.35, turret) * (1 - sst(0.5, 0.8, turret)) : 0;
    const n = 1 + wart + fold + rw;
    x *= n; y *= n; z *= n;
    if (vy < -0.55) y = -0.55 * 0.58 + (y + 0.55 * 0.58) * 0.35;   // flattened crown underneath
    p.setXYZ(i, x, y, z);
    const pale = sst(-0.1, -0.5, vy);                               // pale below, like a real octopus
    const c = (0.80 + 0.25 * sst(0.0, 0.03, wart)) * (1 - 0.30 * crease * sst(0.05, 0.7, back)) * (1 - 0.15 * sst(0.3, 0.9, turret));
    col[i * 3] = c + 0.35 * pale; col[i * 3 + 1] = c * 0.97 + 0.30 * pale; col[i * 3 + 2] = c * 0.98 + 0.28 * pale;
    uv.setXY(i, u * 6, v * 3);                                      // ~6 world units per UV unit
    // the second projection, about X (its seam at -Z and its poles at +-X sit where wB = 0)
    uvB[i * 2] = (Math.atan2(vy, vz) / TAU + 0.5) * 6; uvB[i * 2 + 1] = Math.acos(Math.max(-1, Math.min(1, vx))) / Math.PI * 3;
    wB[i] = sst(0.55, 0.85, Math.abs(vy));
  }
  g.setAttribute('uvB', new THREE.BufferAttribute(uvB, 2));
  g.setAttribute('wB', new THREE.BufferAttribute(wB, 1));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return mergeGeometries([g, siphonGeo()]);
}
// The siphon: a muscular funnel out of the mantle opening under her left eye, lipped,
// dark inside.
function siphonGeo(rings = 20, radial = 22) {
  const P0 = new THREE.Vector3(-0.52, -0.22, 0.02), P1 = new THREE.Vector3(-0.74, -0.26, 0.20), P2 = new THREE.Vector3(-0.80, -0.36, 0.44);
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const c = new THREE.Vector3(), t = new THREE.Vector3(), u = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
  // profile along the funnel: radius, and at the mouth a lip that folds back inside
  const prof = [];
  for (let i = 0; i <= rings; i++) prof.push({ s: i / rings, r: 0.105 - 0.03 * (i / rings) + 0.02 * sst(0.8, 1, i / rings), inner: false });
  prof.push({ s: 1.02, r: 0.085, inner: false }, { s: 1.0, r: 0.068, inner: true }, { s: 0.9, r: 0.062, inner: true }, { s: 0.75, r: 0.05, inner: true });
  const row = radial + 1;
  prof.forEach((q, i) => {
    const s = Math.min(1, q.s), m = 1 - s;
    c.set(0, 0, 0).addScaledVector(P0, m * m).addScaledVector(P1, 2 * m * s).addScaledVector(P2, s * s);
    t.set(0, 0, 0).addScaledVector(P1.clone().sub(P0), 2 * m).addScaledVector(P2.clone().sub(P1), 2 * s).normalize();
    if (q.s > 1) c.addScaledVector(t, 0.02);
    u.copy(up).addScaledVector(t, -up.dot(t)).normalize(); b.crossVectors(t, u);
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * TAU, fl = 1 + 0.08 * Math.sin(a * 3 + s * 6);
      d.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
      pos.push(c.x + d.x * q.r * fl, c.y + d.y * q.r * 0.85 * fl, c.z + d.z * q.r * fl);
      const sg = q.inner ? -1 : 1;
      nor.push(d.x * sg, d.y * sg, d.z * sg);
      uv.push(j / radial, q.s * 0.6);
      const k = q.inner ? 0.18 : (q.s > 0.95 ? 1.18 : 0.9 + 0.1 * Math.sin(a * 5));
      col.push(k * 1.05, k * 0.95, k * 0.95);
    }
    if (i > 0) for (let j = 0; j < radial; j++) { const a0 = (i - 1) * row + j, b0 = a0 + row; idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uvB', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('wB', new THREE.Float32BufferAttribute(new Float32Array(uv.length / 2), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---- the eye -----------------------------------------------------------------------------
// A planar-mapped iris on the front of the ball (+Z): gold with radial fibrils and a dark
// limbal ring, the octopus's horizontal BAR pupil, a brassy crypt fleck; the ball beyond
// the iris is a dark silvered sclera. The front bulges into a cornea dome (eyeBallGeo).
let _eye = null;
export function eyeMaps(S = 512) {
  if (_eye) return _eye;
  const alb = new Uint8Array(S * S * 4), emi = new Uint8Array(S * S * 4), { A: TA, B: TB } = NT();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const px = (x + 0.5) / S * 2 - 1, py = (y + 0.5) / S * 2 - 1, r = Math.hypot(px, py), th = Math.atan2(py, px), j = (y * S + x) * 4;
    const fib = nt(TB, th / TAU * 8, r * 3), fib2 = nt(TA, th / TAU * 24, r * 5);
    let c = [0.05, 0.05, 0.055], e = 0;
    const IR = 0.80;
    if (r < IR) {
      const k = r / IR;
      c = [0.78 - 0.30 * k, 0.55 - 0.25 * k, 0.16 - 0.06 * k];
      const f = 0.7 + 0.5 * fib + 0.25 * (fib2 - 0.5);
      c = c.map(q => q * f);
      const collar = Math.exp(-(((k - 0.42) / 0.06) ** 2));                    // the iris collarette
      c = c.map((q, i) => q + [0.20, 0.13, 0.02][i] * collar);
      const limb = sst(0.80, 0.98, k);                                       // limbal ring
      c = c.map(q => q * (1 - 0.8 * limb));
      e = (1 - limb) * (0.6 + 0.4 * f);
      // the bar pupil: a horizontal rounded slot, fattest in the middle
      const hw = 0.46, hh = 0.085 * (1 - 0.5 * (px / hw) ** 2);
      const inP = Math.abs(px) < hw && Math.abs(py) < hh;
      const edge = Math.min(hw - Math.abs(px), hh - Math.abs(py));
      if (inP) { const q = sst(0, 0.025, edge); c = c.map(v => v * (1 - q) + 0.008 * q); e *= 1 - q; }
    } else {
      const m = 0.6 + 0.4 * nt(TA, px * 2 + 3, py * 2 + 1);
      c = [0.10 * m, 0.09 * m, 0.10 * m];
    }
    for (let k = 0; k < 3; k++) { alb[j + k] = Math.min(255, c[k] * 255); emi[j + k] = Math.min(255, c[k] * e * 1.4 * 255); }
    alb[j + 3] = emi[j + 3] = 255;
  }
  _eye = { map: dataTex(alb, S, S, true), emissiveMap: dataTex(emi, S, S, true) };
  for (const t of [_eye.map, _eye.emissiveMap]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return _eye;
}
// The ball: radius r looking down +Z, the front raised into a cornea dome; UV is a planar
// projection over the front so the iris map is undistorted.
export function eyeBallGeo(r = 0.16, cornea = 0.10) {
  const g = new THREE.SphereGeometry(r, 40, 30);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), cz = z / r;
    const dome = cz > 0.55 ? cornea * r * Math.pow((cz - 0.55) / 0.45, 1.6) : 0;
    p.setXYZ(i, x * (1 + dome / r * 0.2), y * (1 + dome / r * 0.2), z + dome);
    uv.setXY(i, 0.5 + x / (2 * r * 0.96), 0.5 + y / (2 * r * 0.96));
  }
  g.computeVertexNormals();
  return g;
}
// A lid: a spherical cap over +Y ending in a fleshy rolled lip (lathed; mirrored in y for
// the lower lid). Vertex colour pinks the lip; UVs at the skin's density.
export function lidGeo(R = 0.178, lower = false, radial = 36) {
  const P = [];
  // the cap carries folds parallel to its edge (a lid is slack skin, not a shell)
  for (let k = 0; k <= 24; k++) {
    const ph = k / 24 * Math.PI / 2, rr = R * (1 + 0.022 * Math.pow(Math.abs(Math.sin(ph * 14)), 3) * sst(0.5, 1.3, ph));
    P.push([rr * Math.sin(ph), rr * Math.cos(ph), 0]);
  }
  P.push([R + 0.005, -0.004, 1], [R + 0.008, -0.011, 1], [R + 0.004, -0.018, 1], [R - 0.004, -0.019, 1], [R - 0.010, -0.012, 1], [R - 0.012, 0.0, 0.6], [R - 0.013, 0.02, 0.4]);
  const pts = P.map(([x, y]) => new THREE.Vector2(x, lower ? -y : y));
  if (!lower) pts.reverse();                                     // keep the winding outward
  const g = new THREE.LatheGeometry(pts, radial);
  g.rotateY(Math.PI);                                              // the lathe seam to the back
  const n = g.attributes.position.count, col = new Float32Array(n * 3), uv = g.attributes.uv;
  const lip = lower ? P : P.slice().reverse(), rows = pts.length;
  for (let i = 0; i < n; i++) {
    const row = i % rows, L = lip[row][2];
    const c = 0.9 + 0.35 * L;
    col[i * 3] = c * 1.08; col[i * 3 + 1] = c * 0.92; col[i * 3 + 2] = c * 0.92;
    uv.setXY(i, uv.getX(i) * 1.0, uv.getY(i) * 0.35);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// ---- suckers -----------------------------------------------------------------------------
// A stalked cup facing +Y: a short stalk into the flesh, the outer wall, a pale rolled RIM,
// the pink inner cup (infundibulum) and the dark central opening (acetabulum).
export function suckerGeo(radial = 12) {
  const P = [
    [0.50, -0.40, 0.55], [0.56, -0.12, 0.6], [0.80, 0.00, 0.66], [0.96, 0.10, 0.72], [1.00, 0.19, 0.8],
    [0.93, 0.26, 0.88], [0.80, 0.23, 0.78], [0.62, 0.15, 0.58], [0.40, 0.08, 0.42], [0.22, 0.03, 0.09], [0.12, -0.06, 0.04], [0.0, -0.08, 0.03]
  ];
  const g = new THREE.LatheGeometry(P.map(([r, y]) => new THREE.Vector2(r, y)), radial);
  const n = g.attributes.position.count, col = new Float32Array(n * 3), rows = P.length;
  for (let i = 0; i < n; i++) {
    const k = P[i % rows][2];
    col[i * 3] = k; col[i * 3 + 1] = k * 0.86; col[i * 3 + 2] = k * 0.84;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

// ---- the arm tube --------------------------------------------------------------------------
// (rings+1) x (radial+1) grid; positions/normals written per frame by hoarder.js. UVs at the
// skin density (u 6 per arm, v 2 round it — integers, so the wrap is seamless).
export function armTubeGeo(rings, radial) {
  const g = new THREE.BufferGeometry();
  const nv = (rings + 1) * (radial + 1);
  const uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
  for (let i = 0; i <= rings; i++) for (let j = 0; j <= radial; j++) {
    const k = i * (radial + 1) + j, a = (j % radial) / radial * TAU;
    uv[k * 2] = i / rings * 6; uv[k * 2 + 1] = j / radial * 2;
    // the oral face (-U) is pale; the crest dark; the ridge darkest
    const pale = sst(-0.25, -0.75, Math.cos(a)), ridge = Math.exp(-((Math.sin(a) / 0.3) ** 2)) * (Math.cos(a) > 0 ? 1 : 0);
    const c = (0.92 + 0.08 * Math.sin(a * 3)) * (1 - 0.18 * ridge);
    col[k * 3] = c + 0.62 * pale; col[k * 3 + 1] = c + 0.40 * pale; col[k * 3 + 2] = c + 0.34 * pale;
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

// ---- the hoard's props -------------------------------------------------------------------
// Built pieces, each returned as { brass/iron/wood..., glass } geometries in local space, with
// vertex colour carrying patina, grime and wear (the materials stay plain).
function colorize(g, fn) {
  const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3), c = [1, 1, 1];
  for (let i = 0; i < n; i++) { fn(p.getX(i), p.getY(i), p.getZ(i), c); col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function clean(g) {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}
function mergeClean(list) {
  const idxd = list.map(g => clean(g)).map(g => g.index ? g : indexify(g));
  return mergeGeometries(idxd);
}
function indexify(g) {
  const n = g.attributes.position.count, idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
// patina: verdigris low and in the joints, dark tarnish, bright wear on the high edges
function patina(seed, h) {
  return (x, y, z, c) => {
    const n = fbm(x * 3 + seed, z * 3 + y * 2, 1, 5), low = 1 - sst(0.0, 0.35 * h, y);
    const verd = sst(0.45, 0.7, n) * (0.35 + 0.65 * low);
    const tarn = 0.55 + 0.45 * fbm(x * 9 + y * 7, z * 9 + seed, 2, 5);
    c[0] = tarn * (1 - verd) + 0.30 * verd; c[1] = tarn * (1 - verd) + 0.62 * verd; c[2] = tarn * (1 - verd) + 0.52 * verd;
  };
}
// A post: an octagonal (chamfered square) bar between two heights.
function post(x, z, y0, y1, w) {
  const g = new THREE.CylinderGeometry(w, w, y1 - y0, 8, 1, false);
  g.rotateY(Math.PI / 8);
  g.translate(x, (y0 + y1) / 2, z);
  return g;
}
function lathe(P, radial, y0 = 0) {
  return new THREE.LatheGeometry(P.map(([r, y]) => new THREE.Vector2(r, y + y0)), radial);
}
// THE DROWNED LANTERN (unit ~1 tall): a stepped lathed foot, four chamfered posts with
// wire guard hoops, a hinged door frame on one face (hinge knuckles, a latch), a burner
// collar with its wick inside a GLASS CHIMNEY (the glass is its own geometry: it carries
// the grime gradient in vertex colour), a vented cap with a chimney stub and a ring bail.
export function lanternParts() {
  const B = [];
  B.push(lathe([[0.0, 0.0], [0.30, 0.0], [0.32, 0.02], [0.32, 0.05], [0.29, 0.07], [0.29, 0.09], [0.25, 0.11], [0.24, 0.13], [0.0, 0.13]], 24));
  // burner collar + wick knob
  B.push(lathe([[0.0, 0.13], [0.11, 0.13], [0.12, 0.16], [0.09, 0.19], [0.07, 0.21], [0.0, 0.21]], 16));
  const knob = new THREE.CylinderGeometry(0.018, 0.018, 0.08, 8); knob.rotateZ(Math.PI / 2); knob.translate(0.13, 0.17, 0); B.push(knob);
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * TAU + Math.PI / 4;
    B.push(post(Math.cos(a) * 0.25, Math.sin(a) * 0.25, 0.10, 0.70, 0.02));
  }
  // guard hoops
  for (const y of [0.30, 0.52]) { const t = new THREE.TorusGeometry(0.25, 0.010, 5, 32); t.rotateX(Math.PI / 2); t.translate(0, y, 0); B.push(t); }
  // the door: a frame on the +X face with hinge knuckles and a latch
  const door = (w, h, x0, y0) => {
    for (const [dx, dy, sx, sy] of [[0, -h / 2, w, 0.02], [0, h / 2, w, 0.02], [-w / 2, 0, 0.02, h], [w / 2, 0, 0.02, h]]) {
      const bx = new THREE.BoxGeometry(0.018, sy, sx); bx.translate(x0, y0 + dy, dx); B.push(bx);
    }
    for (const ky of [-0.14, 0.0, 0.14]) { const kn = new THREE.CylinderGeometry(0.014, 0.014, 0.05, 8); kn.translate(x0 + 0.004, y0 + ky, -w / 2 - 0.012); B.push(kn); }
    const la = new THREE.BoxGeometry(0.03, 0.02, 0.05); la.translate(x0 + 0.012, y0, w / 2 + 0.02); B.push(la);
  };
  door(0.30, 0.46, 0.262, 0.40);
  // cap: a skirt, a vented cone, the chimney stub, the ring bail
  B.push(lathe([[0.0, 0.66], [0.31, 0.66], [0.32, 0.69], [0.28, 0.71], [0.20, 0.78], [0.12, 0.83], [0.08, 0.84], [0.08, 0.93], [0.10, 0.94], [0.10, 0.96], [0.0, 0.96]], 24));
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * TAU, v = new THREE.BoxGeometry(0.035, 0.018, 0.012);
    v.rotateY(-a); v.translate(Math.cos(a) * 0.235, 0.745, Math.sin(a) * 0.235); B.push(v);
  }
  const bail = new THREE.TorusGeometry(0.13, 0.016, 6, 24, Math.PI * 1.25); bail.rotateZ(-Math.PI * 0.125); bail.translate(0, 0.98, 0); B.push(bail);
  const brass = mergeClean(B);
  colorize(brass, patina(3.1, 1));
  brass.computeVertexNormals();
  // glass chimney: a bellied globe, grimed toward its ends, a sooted crown
  const glass = lathe([[0.10, 0.19], [0.17, 0.24], [0.21, 0.34], [0.215, 0.42], [0.20, 0.52], [0.15, 0.60], [0.10, 0.65]], 24);
  clean(glass);
  colorize(glass, (x, y, z, c) => {
    const mid = Math.exp(-(((y - 0.38) / 0.12) ** 2)), soot = sst(0.52, 0.65, y), gr = 0.7 + 0.3 * fbm(x * 8 + 1, z * 8 + y * 6, 1, 5);
    const k = (0.25 + 0.75 * mid) * (1 - 0.8 * soot) * gr;
    c[0] = k; c[1] = k * 0.92; c[2] = k * 0.80;
  });
  glass.computeVertexNormals();
  // the flame: a small teardrop over the wick (drawn with the glass: it is the bright core)
  const flame = lathe([[0.0, 0.21], [0.03, 0.25], [0.035, 0.29], [0.02, 0.34], [0.0, 0.37]], 10);
  clean(flame);
  colorize(flame, (x, y, z, c) => { c[0] = 2.2; c[1] = 1.9; c[2] = 1.4; });
  return { brass, glass: mergeClean([glass, flame]) };
}
// THE SHIP'S LAMP (hero, ~2x the lantern's build): a riveted drum body with a ribbed
// FRESNEL glass band between two brass rims, four stays, a hinged service door with a
// porthole, a stepped crown with a cowled chimney and the carrying bail, a gimbal yoke.
export function shipLampParts() {
  const B = [];
  B.push(lathe([[0.0, 0.0], [0.36, 0.0], [0.38, 0.02], [0.38, 0.06], [0.35, 0.08], [0.35, 0.16], [0.37, 0.18], [0.37, 0.21], [0.33, 0.23], [0.0, 0.23]], 40));
  // rivets round the drum
  for (let k = 0; k < 24; k++) { const a = k / 24 * TAU, r = new THREE.SphereGeometry(0.012, 6, 4); r.translate(Math.cos(a) * 0.352, 0.12, Math.sin(a) * 0.352); B.push(r); }
  // lower and upper lens rims
  B.push(lathe([[0.33, 0.23], [0.345, 0.235], [0.345, 0.26], [0.30, 0.265]], 40));
  B.push(lathe([[0.30, 0.60], [0.345, 0.605], [0.345, 0.63], [0.33, 0.635]], 40));
  for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + Math.PI / 4; B.push(post(Math.cos(a) * 0.335, Math.sin(a) * 0.335, 0.24, 0.63, 0.022)); }
  // the crown
  B.push(lathe([[0.0, 0.63], [0.36, 0.63], [0.37, 0.66], [0.33, 0.68], [0.30, 0.70], [0.22, 0.78], [0.14, 0.84], [0.10, 0.86], [0.10, 0.98], [0.15, 1.00], [0.16, 1.04], [0.12, 1.06], [0.0, 1.06]], 40));
  // the cowl over the chimney
  const cowl = new THREE.SphereGeometry(0.17, 20, 10, 0, TAU, 0, Math.PI / 2); cowl.scale(1, 0.55, 1); cowl.translate(0, 1.07, 0); B.push(cowl);
  for (let k = 0; k < 12; k++) { const a = k / 12 * TAU, v = new THREE.BoxGeometry(0.04, 0.02, 0.014); v.rotateY(-a); v.translate(Math.cos(a) * 0.27, 0.73, Math.sin(a) * 0.27); B.push(v); }
  // bail and gimbal yoke
  const bail = new THREE.TorusGeometry(0.24, 0.022, 8, 32, Math.PI); bail.translate(0, 1.10, 0); B.push(bail);
  for (const sd of [-1, 1]) {
    const lug = new THREE.CylinderGeometry(0.035, 0.035, 0.05, 12); lug.rotateZ(Math.PI / 2); lug.translate(sd * 0.39, 0.42, 0); B.push(lug);
    const arm = new THREE.BoxGeometry(0.03, 0.30, 0.05); arm.translate(sd * 0.42, 0.29, 0); B.push(arm);
  }
  const yoke = new THREE.BoxGeometry(0.87, 0.03, 0.06); yoke.translate(0, 0.14, 0); B.push(yoke);
  // the service door with a porthole, on the drum's +Z face
  const port = new THREE.TorusGeometry(0.05, 0.012, 6, 20); port.translate(0, 0.12, 0.365); B.push(port);
  for (const ky of [0.06, 0.18]) { const kn = new THREE.CylinderGeometry(0.012, 0.012, 0.03, 8); kn.translate(-0.10, ky, 0.36); B.push(kn); }
  const brass = mergeClean(B);
  colorize(brass, patina(7.7, 1.1));
  brass.computeVertexNormals();
  // FRESNEL band: a lathed lens with stacked prism ridges, bellied
  const L = [];
  for (let k = 0; k <= 9; k++) {
    const y = 0.265 + k / 9 * 0.335, belly = 0.30 + 0.035 * Math.sin(k / 9 * Math.PI);
    L.push([belly, y]);
    if (k < 9) L.push([belly + 0.018, y + 0.012], [belly + 0.004, y + 0.030]);
  }
  const glass = lathe(L, 48);
  clean(glass);
  colorize(glass, (x, y, z, c) => {
    const mid = Math.exp(-(((y - 0.43) / 0.16) ** 2)), gr = 0.65 + 0.35 * fbm(x * 6 + 4, z * 6 + y * 4, 1, 5), soot = sst(0.52, 0.6, y);
    const k = (0.3 + 0.7 * mid) * gr * (1 - 0.6 * soot);
    c[0] = k; c[1] = k * 0.9; c[2] = k * 0.74;
  });
  glass.computeVertexNormals();
  const flame = lathe([[0.0, 0.24], [0.05, 0.30], [0.06, 0.37], [0.035, 0.45], [0.0, 0.50]], 12);
  clean(flame);
  colorize(flame, (x, y, z, c) => { c[0] = 2.4; c[1] = 2.0; c[2] = 1.4; });
  return { brass, glass: mergeClean([glass, flame]) };
}
// THE CRATE (2.4 x 1.4 x 1.8, centred): planks with gaps and chamfers on every face,
// battens, IRON angle corners and nail heads. { wood, iron }, vertex-coloured.
export function crateParts(W = 2.4, H = 1.4, D = 1.8, seed = 0xC2A7E) {
  const rnd = seededRand(seed), wood = [], iron = [];
  const plank = (sx, sy, sz, x, y, z, tone) => {
    const g = new THREE.BoxGeometry(sx, sy, sz, 1, 1, 1);
    // chamfer: pull the corners in a touch (a 4-segment box would cost more)
    g.translate(x, y, z);
    const col = new Float32Array(g.attributes.position.count * 3), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const q = tone * (0.85 + 0.25 * fbm(p.getX(i) * 1.7 + seed % 7, p.getY(i) * 1.3 + p.getZ(i) * 1.1, 1, 4));
      col[i * 3] = q; col[i * 3 + 1] = q * 0.86; col[i * 3 + 2] = q * 0.70;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    wood.push(g);
  };
  const t = 0.06, gap = 0.025;
  // long faces (+-Z): 5 horizontal planks each
  for (const sz of [-1, 1]) for (let k = 0; k < 5; k++) {
    const h = (H - gap * 4) / 5, y = -H / 2 + h / 2 + k * (h + gap);
    plank(W - 0.02, h, t, 0, y, sz * (D / 2 - t / 2), 0.7 + 0.35 * rnd());
  }
  // short faces (+-X): 4 vertical planks each
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) {
    const w = (D - 2 * t - gap * 3) / 4, z = -D / 2 + t + w / 2 + k * (w + gap);
    plank(t, H - 0.02, w, sx * (W / 2 - t / 2), 0, z, 0.7 + 0.35 * rnd());
  }
  // lid: 6 planks across, and two battens over them
  for (let k = 0; k < 6; k++) {
    const w = (W - gap * 5) / 6, x = -W / 2 + w / 2 + k * (w + gap);
    plank(w, t, D - 0.02, x, H / 2 - t / 2 + 0.005, 0, 0.65 + 0.35 * rnd());
  }
  for (const bx of [-W * 0.3, W * 0.3]) plank(0.14, 0.05, D + 0.04, bx, H / 2 + 0.03, 0, 0.55);
  for (const sz of [-1, 1]) for (const bx of [-W * 0.3, W * 0.3]) plank(0.14, H * 0.9, 0.05, bx, 0, sz * (D / 2 + 0.025), 0.55);
  // iron: angle brackets down every vertical edge and round the top corners, nail heads
  const angle = (len, x, y, z, rotY, horiz) => {
    for (const [a, b] of [[0.16, 0.012], [0.012, 0.16]]) {
      const g = new THREE.BoxGeometry(a, len, b);
      g.translate(a / 2 - 0.006, 0, b / 2 - 0.006);
      if (horiz) g.rotateZ(Math.PI / 2);
      g.rotateY(rotY); g.translate(x, y, z); iron.push(g);
    }
  };
  const cx = W / 2 + 0.008, cz = D / 2 + 0.008;
  for (const [sx, sz, ry] of [[1, 1, Math.PI], [-1, 1, Math.PI / 2], [-1, -1, 0], [1, -1, -Math.PI / 2]]) {
    angle(H * 0.42, sx * cx, H / 2 - H * 0.21, sz * cz, ry, false);
    angle(H * 0.30, sx * cx, -H / 2 + H * 0.15, sz * cz, ry, false);
    for (let k = 0; k < 4; k++) { const nh = new THREE.CylinderGeometry(0.018, 0.018, 0.012, 6); nh.rotateX(Math.PI / 2); nh.translate(sx * (W / 2 - 0.08), H / 2 - 0.1 - k * 0.12, sz * (D / 2 + 0.014)); iron.push(nh); }
  }
  for (const g of iron) colorize(g, (x, y, z, c) => { const r = sst(0.4, 0.75, fbm(x * 4 + 9, y * 4 + z * 3, 1, 5)); c[0] = 0.10 + 0.22 * r; c[1] = 0.09 + 0.09 * r; c[2] = 0.085 + 0.03 * r; });
  const w = mergeClean(wood), ir = mergeClean(iron);
  w.computeVertexNormals(); ir.computeVertexNormals();
  return { wood: w, iron: ir };
}
// A small wood grain map for the crate: long fibres, knots, a silted grey bloom.
let _wood = null;
export function woodMaps(S = 256) {
  if (_wood) return _wood;
  const { A: TA, B: TB, C: TC } = NT();
  const alb = new Uint8Array(S * S * 4), nrm = new Uint8Array(S * S * 4), Hf = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S, v = (y + 0.5) / S, i = y * S + x, j = i * 4;
    const warp = nt(TA, u * 2, v * 2) * 0.6, fib = nt(TC, u * 4, v * 64 + warp * 20), ring = 0.5 + 0.5 * Math.sin((v * 18 + warp * 4 + nt(TB, u * 3, v * 3)) * TAU);
    const g = 0.55 + 0.25 * fib + 0.2 * ring, bloom = sst(0.5, 0.8, nt(TB, u * 5 + 0.3, v * 5));
    Hf[i] = 0.0012 * fib + 0.0006 * ring;
    const c = [0.42 * g, 0.31 * g, 0.21 * g].map(q => q * (1 - bloom) + 0.30 * bloom);
    for (let k = 0; k < 3; k++) alb[j + k] = Math.min(255, c[k] * 255);
    alb[j + 3] = 255;
  }
  normalsInto(nrm, Hf, S, S, 1, true);
  _wood = { map: dataTex(alb, S, S, true), normalMap: dataTex(nrm, S, S, false) };
  return _wood;
}

// shared with hunter.js (Mhor's club)
export { colorize as paint, mergeClean };
export const suckerRaw = radial => suckerGeo(radial);
