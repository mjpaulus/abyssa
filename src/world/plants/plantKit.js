// ABYSSA — plantKit.js. OWNED BY: the plants track (sculpted sessile life).
//
// The SWAP LAYER between the procedural plant builders (flora.js, gardens.js — which keep
// owning placement, every stream draw, every fingerprint) and the sculpted species baked by
// tools/blender (src/world/plants/plantsSculpt.js -> assets/plants/).
//
// A host builds and lays out its InstancedMesh exactly as before, then ADOPTS it:
//   plantAdopt(key, species, im, opts)   after every layout (build AND reseed). Pure
//       bookkeeping: remembers the mesh; nothing is drawn differently until the asset is in.
// When the asset arrives (loadSculpted, off the critical path; never throws), every adopted
// key gets ONE BatchedMesh — one multi-draw — holding all of its species' VARIANTS (near low
// + far LOD each). Its instances mirror the host mesh's (matrix, tint, aInst) one for one, so
// the layout is literally the host's; the variant is a hash of the instance index (no stream
// draw), the LOD a distance test each frame, instances past the host's range fade are not
// submitted at all (the old meshes ran every vertex of every instance in the zone and
// collapsed the far ones in the shader). The host mesh is hidden, never disposed: if the
// asset fails, or under ?plantproc, the procedural build simply keeps drawing.
//
// Materials come from the host's own factory (gardens.js gardenMat, registered here through
// setPlantMaterial), so the sculpted plants sway in the SAME vertex program family off the
// same shared uniforms (current field, stir.js push spheres, jolt) — gardens.js reads the
// batch's per-instance aInst out of a small float texture instead of an attribute. Built
// once per key at asset arrival, compiled with compileAsync BEFORE they are shown (no
// mid-dive compile stall), never recreated on a reseed (reseed = rewrite instances in place).
//
//   plantTick()   once per frame (gardens.js updateGardens): visibility mirror + LOD.
//   window.__plants  { state(), proc(on), lod(on) } dev surface.
import * as THREE from 'three';
import { camera, scene, renderer } from '../../core.js';
import { loadSculpted } from '../../lib/assets.js';
import { applyMicroDetail, patchNormalRG, microTextureStep } from '../../lib/microDetail.js';
import { SWAY, whipRemap } from './plantsSculpt.js';
import { buildKelp, kelpRemap, KELP_VARIANTS, buildGrass, GRASS_VARIANTS } from './bladesSculpt.js';

const BASE = 'assets/plants/', BASE_B = 'assets/blades/', BASE_I = 'assets/imp/';
const OFF = typeof location !== 'undefined' && /[?&]plantproc\b/.test(location.search);
let asset = null, assetB = null, assetI = null, state = OFF ? 'off' : 'loading', matFactory = null, procForced = false, lodOn = true;
const keys = new Map();          // key -> K
const root = new THREE.Group(); root.name = 'plantKit';
const t0 = performance.now();
let loadMs = 0, buildMs = 0;

export function setPlantMaterial(fn) { matFactory = fn; }

// species-level knobs: LOD switch distance (u), tint softening (0 = grey, 1 = host hue)
// micro: microDetail tiles per object unit (0 = none: the alpha cards' strands are finer
// than its grain)
const F = THREE.FrontSide, D2 = THREE.DoubleSide;
const SPEC = {
  tube: { noMid: true, near: 14, tint: 0.6, micro: 14, side: F },
  anem: { noMid: true, near: 11, tint: 0.55, micro: 22, side: F },
  barrel: { near: 22, tint: 0.55, micro: 8, side: F },
  worm: { noMid: true, near: 14, tint: 0.25, micro: 18, side: F },
  stag: { near: 15, tint: 0.5, micro: 20, side: F },
  brain: { near: 10, tint: 0.5, micro: 10, side: F },
  table: { near: 10, tint: 0.5, micro: 12, side: F },
  glass: { near: 18, tint: 0.2, micro: 0, side: D2 },
  fan: { near: 18, tint: 0.45, micro: 0, side: D2 },
  crin: { near: 12, tint: 0.5, micro: 0, side: D2 },
  // (plants2) deep and vent species
  pen: { noMid: true, near: 12, tint: 0.5, micro: 0, side: F },
  whip: { near: 16, tint: 0.45, micro: 0, side: F, remap: whipRemap },
  mat: { near: 10, tint: 0.3, micro: 0, side: F },
  // (plants2) RUNTIME-ASSEMBLED species (bladesSculpt.js): baked card atlases from the
  // 'blades' asset, plants built at load from their seeds at three LODs. `lods` are fixed
  // switch distances (u); `remap` re-picks the variant and the proportions per instance.
  // kelp: OPAQUE (no alpha, no dither: see gardens.js GD_NODITHER), drawn turned to the current
  kelp: { lods: [14, 40], tint: 0.15, micro: 0, side: D2, build: buildKelp, nv: KELP_VARIANTS.length, remap: kelpRemap, asset: 'blades', opaque: true, def: ['NODITHER'] },
  grass: { lods: [11, 24], tint: 0.6, micro: 0, side: D2, build: buildGrass, nv: GRASS_VARIANTS.length, asset: 'blades' }
};

export function plantAdopt(key, species, im, opts) {
  let K = keys.get(key);
  if (!K) { K = { key, species, opts, im: null, batch: null, dirty: true, ready: false }; keys.set(key, K); }
  K.im = im; K.dirty = true;
  im.userData.plantKey = key; im.userData.plantSp = species;
  return K;
}

// two assets: the sculpted 3D species ('plants') and the blade cards ('blades'); either may
// fail alone (its species then simply stay procedural)
// DEV: ?plantsx=<sets> overlays a partial rebake (bake.py --sets writes plants_<sets>.glb/json)
// over the full asset, so one species can be iterated without a full build
const XS = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('plantsx') : null;
function overlay(a, x) {
  if (!x) return a;
  if (!a) return x;
  Object.assign(a.geos, x.geos); Object.assign(a.maps, x.maps); Object.assign(a.meta.sets, x.meta.sets);
  for (const k in x.meta.meta.sk) a.meta.meta.sk[k] = x.meta.meta.sk[k];
  for (const k in x.meta.meta.species) a.meta.meta.species[k] = x.meta.meta.species[k];
  return a;
}
if (!OFF) Promise.all([loadSculpted(BASE, 'plants'), loadSculpted(BASE_B, 'blades'), XS ? loadSculpted(BASE, 'plants_' + XS) : null, /[?&]noimp\b/.test(location.search) ? null : loadSculpted(BASE_I, 'imp')]).then(([a0, b, x, im]) => {
  assetI = im;
  const a = overlay(a0, x);
  loadMs = performance.now() - t0;
  if (!a && !b) { state = 'failed'; return; }
  asset = a; assetB = b; state = 'loaded';
});
const assetOf = sp => SPEC[sp] && SPEC[sp].asset === 'blades' ? assetB : asset;
const hasSpecies = sp => { const S = SPEC[sp]; if (!S) return false; const A = assetOf(sp); return !!(A && (S.build ? A.maps[sp] : A.geos[sp + '_v0'])); };

// ---- geometry: one prepared BufferGeometry per piece (near + far), sway attributes derived
const _geoCache = new Map();
function runtimeGeo(species, v, lod) {
  const name = species + '_v' + v + '_L' + lod;
  if (_geoCache.has(name)) return _geoCache.get(name);
  const o = SPEC[species].build(v, lod), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(o.uv, 2));
  g.setAttribute('aVA', new THREE.BufferAttribute(o.aVA, 4));
  g.setAttribute('aFlut', new THREE.BufferAttribute(o.aFlut, 1));
  g.setAttribute('aBU', new THREE.BufferAttribute(o.aBU, 2));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  _geoCache.set(name, g);
  return g;
}
function pieceGeo(species, v, far) {
  const name = species + '_v' + v + (far === 2 ? '_far2' : far ? '_far' : '');   // '_v': assets.js folds a trailing _<digits> (GLTFLoader's de-dup)
  if (_geoCache.has(name)) return _geoCache.get(name);
  const src = asset.geos[name];
  if (!src) return null;
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'uv', 'tangent']) if (src.attributes[k]) g.setAttribute(k, src.attributes[k]);
  g.setIndex(src.index);
  const pos = g.attributes.position, n = pos.count;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const y = pos.getY(i); if (y < lo) lo = y; if (y > hi) hi = y; }
  const sk = asset.meta.meta.sk[species][v], fn = SWAY[species];
  const va = new Float32Array(n * 4), fl = new Float32Array(n), bu = new Float32Array(n * 2);
  const span = Math.max(1e-4, hi - Math.max(0, lo));
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), h = Math.min(1, Math.max(0, y / span));
    const r = fn(x, y, z, h, sk);
    va[i * 4] = r[0]; va[i * 4 + 1] = r[1]; va[i * 4 + 2] = r[2]; va[i * 4 + 3] = r[3]; fl[i] = r[4];
    if (r.length > 5) { bu[i * 2] = r[5]; bu[i * 2 + 1] = r[6]; }
  }
  g.setAttribute('aVA', new THREE.BufferAttribute(va, 4));
  g.setAttribute('aFlut', new THREE.BufferAttribute(fl, 1));
  g.setAttribute('aBU', new THREE.BufferAttribute(bu, 2));
  _geoCache.set(name, g);
  return g;
}

function hashV(i, k) { const s = Math.sin(i * 91.345 + 17.13) * 24634.6345; return Math.floor((s - Math.floor(s)) * k) % k; }

// ---- ONE batch per SPECIES (one multi-draw), every host that adopted it a segment of it:
// flora's three zone meshes and gardens' mesh of the same species share the geometry, the
// atlas, the material and the draw; a host whose zone is gated off just submits nothing.
// Hosts' rigidity differences ride per instance (aInst.y = sway amp: flora's stony corals
// write 0), so one material serves them all.
const groups = new Map();        // species -> G
function buildGroup(sp, hosts) {
  const S = SPEC[sp], A = assetOf(sp), nv = S.build ? S.nv : A.meta.meta.species[sp].variants;
  // LOD levels: [level][variant] geometries. Sculpted species: near low + far (bake.py `far`);
  // runtime species: their builder's three levels
  const levels = S.build ? [0, 1, 2].map(l => { const L = []; for (let v = 0; v < nv; v++) L.push(runtimeGeo(sp, v, l)); return L; })
    : (A.geos[sp + '_v0_far2'] ? [0, 1, 2] : [0, 1]).map(l => { const L = []; for (let v = 0; v < nv; v++) L.push(l ? (pieceGeo(sp, v, l) || pieceGeo(sp, v, false)) : pieceGeo(sp, v, false)); return L; });
  let nvx = 0, nix = 0;
  for (const L of levels) for (const g of L) { nvx += g.attributes.position.count; nix += g.index.count; }
  let cap = 0, cull = 0;
  const def = new Set();
  for (const K of hosts) { K.off = cap; cap += K.opts.cap; cull = Math.max(cull, K.opts.mat.cull); for (const d of K.opts.mat.def || []) def.add(d); }
  const maps = A.maps[sp], ormB = A.meta.sets[sp].ormB;
  if (ormB === 'alpha' && !S.opaque) def.add('ALPHA');
  for (const d of S.def || []) def.add(d);
  if (ormB === 'emit') def.add('BIOLUM');   // (plants2) the baked polyp mask glows (gardens.js GD_BIOLUM)
  const o0 = hosts[0].opts.mat, gz = hosts.find(K => K.opts.mat.glowZ);
  const mat = matFactory({
    ...o0, sway: 1, cull, def: [...def], key: 'sc-' + sp, side: S.side, glowZ: gz ? gz.opts.mat.glowZ : null,
    sculpt: { map: maps.map, normalMap: maps.normalMap, orm: maps.ormMap }
  });
  if (maps.normalMap.userData.rg) patchNormalRG(mat);
  if (S.micro) applyMicroDetail(mat, { scale: S.micro, normal: 0.45, cavity: 0.3, rough: 0.2, cav: ormB === 'cavity' });
  const b = new THREE.BatchedMesh(cap, nvx, nix, mat);
  b.perObjectFrustumCulled = true;
  b.sortObjects = false;
  b.frustumCulled = false;
  b.name = 'plants:' + sp;
  const ids = levels.map(L => L.map(g => b.addGeometry(g)));
  // sway headroom: per-object culling uses the rest pose's sphere
  for (const L of ids) for (const id of L) { b.getBoundingSphereAt(id, _sph); const gi = b._geometryInfo && b._geometryInfo[id]; if (gi && gi.boundingSphere) gi.boundingSphere.radius *= 1.35; }
  const lastL = ids[ids.length - 1];
  for (let i = 0; i < cap; i++) { b.addInstance(lastL[0]); b.setVisibleAt(i, false); }
  // per-instance aInst (phase, amp, shrink, weight) for the shared sway program
  const w = Math.ceil(Math.sqrt(cap));
  const it = new THREE.DataTexture(new Float32Array(w * w * 4), w, w, THREE.RGBAFormat, THREE.FloatType);
  it.needsUpdate = true;
  mat.userData.uInstTex = { value: it };
  const G = {
    sp, hosts, batch: b, ids, nv, nl: ids.length, instTex: it, cap, near: S.near, S, impB: null, impOff: 0, impTex: null, impIds: null, nl0: ids.length,
    vis: new Uint8Array(cap), lod: new Uint8Array(cap).fill(255), var: new Uint8Array(cap), px: new Float32Array(cap * 3), cull2: new Float32Array(cap), near2: new Float32Array(cap), mid2: new Float32Array(cap)
  };
  for (let i = 0; i < cap; i++) G.var[i] = hashV(i, nv);
  for (const K of hosts) { K.G = G; K.n = 0; }
  groups.set(sp, G);
  root.add(b);
}

const _sph = new THREE.Sphere();
const _m = new THREE.Matrix4(), _c = new THREE.Color(), _v4 = new THREE.Vector4();
// mirror one host mesh's instances into its segment (after its layout / a reseed)
function sync(K) {
  const G = K.G, im = K.im, b = G.batch, o = K.off, n = Math.min(im.count, K.opts.cap), S = G.S;
  const ai = im.geometry.attributes.aInst.array, td = G.instTex.image.data, c2 = K.opts.mat.cull * K.opts.mat.cull;
  for (let i = 0; i < n; i++) {
    const j = o + i;
    im.getMatrixAt(i, _m);
    const e = _m.elements;
    const sx = Math.hypot(e[0], e[1], e[2]), sy = Math.hypot(e[4], e[5], e[6]), sz = Math.hypot(e[8], e[9], e[10]);
    let amp = ai[i * 4 + 1], shrink = ai[i * 4 + 2];
    if (S.remap) {
      // (plants2) a species drawn at its true proportions: the variant is re-picked from the
      // instance's own size, the basis rescaled, the sway terms carried into the new frame
      const R = S.remap(j, sx, sy, amp, shrink);
      G.var[j] = R.v;
      if (R.cur) {
        // (kelp) turned so its local +x is DOWNSTREAM (the current's base heading): every plant
        // in a forest streams the same way. The up axis (the slope stand) is kept; only the yaw
        // changes — position and height are the host's.
        const ux = e[4] / sy, uy = e[5] / sy, uz = e[6] / sy, d = R.cur[0] * ux + R.cur[2] * uz;
        let xx = R.cur[0] - ux * d, xy = -uy * d, xz = R.cur[2] - uz * d; const xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
        const zx = xy * uz - xz * uy, zy = xz * ux - xx * uz, zz = xx * uy - xy * ux;
        e[0] = xx * R.sx; e[1] = xy * R.sx; e[2] = xz * R.sx; e[4] = ux * R.sy; e[5] = uy * R.sy; e[6] = uz * R.sy; e[8] = zx * R.sx; e[9] = zy * R.sx; e[10] = zz * R.sx;
      } else {
        const kx = R.sx / sx, ky = R.sy / sy, kz = R.sx / sz;
        e[0] *= kx; e[1] *= kx; e[2] *= kx; e[4] *= ky; e[5] *= ky; e[6] *= ky; e[8] *= kz; e[9] *= kz; e[10] *= kz;
      }
      amp = R.amp; shrink = R.shrink;
    }
    b.setMatrixAt(j, _m);
    if (G.impB) { G.impB.setMatrixAt(G.impOff + j, _m); G.impB.setGeometryIdAt(G.impOff + j, G.impIds[G.var[j]]); }
    G.px[j * 3] = e[12]; G.px[j * 3 + 1] = e[13]; G.px[j * 3 + 2] = e[14];
    G.cull2[j] = c2;
    if (S.lods) { G.near2[j] = S.lods[0] * S.lods[0]; G.mid2[j] = S.lods[1] * S.lods[1]; }
    else {
      // the near/far switch scales with the instance's own size (a 4 u table holds its detail
      // further out than a 1 u anemone)
      const nk = G.near * Math.min(2, Math.max(0.7, sy / 1.6));
      // (plants2) a species with an explicit second far LOD (brain, table) drops to it at 2.6x
      const md = G.nl0 > 2 ? nk * 2.6 : Math.max(nk * 2.2, 26);
      G.near2[j] = nk * nk; G.mid2[j] = G.nl > 2 ? md * md : Infinity;
      // (plants2) species whose decimated far mesh stalled at its seams (still 1-4k triangles)
      // skip it: the near mesh holds a little longer, then the impostor takes over
      if (S.noMid && G.impB) { const d = Math.max(nk * 1.5, 16); G.near2[j] = G.mid2[j] = d * d; }
    }
    if (im.instanceColor) im.getColorAt(i, _c); else _c.setRGB(1, 1, 1);
    // soften the host's palette toward its own value: the bake carries the species' colour
    // structure; the tint only varies it (the procedural palettes were tuned for flat albedo)
    const l = 0.2126 * _c.r + 0.7152 * _c.g + 0.0722 * _c.b, k = S.tint;
    const r = l + (_c.r - l) * k, g = l + (_c.g - l) * k, bl = l + (_c.b - l) * k, nrm = 1 / Math.max(0.05, 0.2126 * r + 0.7152 * g + 0.0722 * bl);
    // a gentle share of the host's per-instance brightness jitter (the bake carries the value)
    const lk = Math.min(1.3, Math.max(0.8, 1.02 + 0.8 * (l - 0.3)));
    b.setColorAt(j, _v4.set(r * nrm * lk, g * nrm * lk, bl * nrm * lk, 1));
    if (G.impB) G.impB.setColorAt(G.impOff + j, _v4);
    td[j * 4] = ai[i * 4]; td[j * 4 + 1] = amp; td[j * 4 + 2] = shrink;
    // w: flora's glow weight, tagged with its zone (gardens.js GD_GLOWZ); gardens hosts' w
    // (a hue/pulse weight only the procedural tips read) is dropped
    td[j * 4 + 3] = K.opts.glowZone != null && ai[i * 4 + 3] > 0 ? 4 * (K.opts.glowZone + 1) + Math.min(3.9, ai[i * 4 + 3]) : K.opts.bio ? Math.min(0.999, ai[i * 4 + 3]) : 0;
    if (G.impTex) { const it = G.impTex.image.data, q = (G.impOff + j) * 4; it[q] = td[j * 4]; it[q + 1] = td[j * 4 + 1]; it[q + 2] = td[j * 4 + 2]; it[q + 3] = td[j * 4 + 3]; }
    G.lod[j] = 255;
  }
  for (let i = n; i < K.n; i++) { const j = o + i; if (G.vis[j] === 1) b.setVisibleAt(j, false); else if (G.vis[j] === 2) G.impB.setVisibleAt(G.impOff + j, false); G.vis[j] = 0; }
  K.n = n;
  G.instTex.needsUpdate = true;
  if (G.impTex) G.impTex.needsUpdate = true;
  K.dirty = false;
}

// per host segment: visible = the host's zone gate is open and the instance is inside the
// host's range; the LOD level by distance (two levels for the sculpted species, three for the
// runtime ones)
function lodPass(G, K, on) {
  const b = G.batch, cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  const P = G.px, N2 = G.near2, M2 = G.mid2, top = G.nl - 1, IB = G.impB, io = G.impOff;
  for (let i = K.off, e = K.off + K.n; i < e; i++) {
    // want: 0 hidden, 1 in the species batch, 2 in the impostor batch (the far level)
    let want = 0, l = 0;
    if (on) { const dx = P[i * 3] - cx, dy = P[i * 3 + 1] - cy, dz = P[i * 3 + 2] - cz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < G.cull2[i]) { l = !lodOn || d2 <= N2[i] ? 0 : (d2 <= M2[i] ? 1 : top); want = IB && l === top ? 2 : 1; } }
    if (want !== G.vis[i]) {
      if (G.vis[i] === 1) b.setVisibleAt(i, false); else if (G.vis[i] === 2) IB.setVisibleAt(io + i, false);
      if (want === 1) b.setVisibleAt(i, true); else if (want === 2) IB.setVisibleAt(io + i, true);
      G.vis[i] = want;
    }
    if (want === 1 && l !== G.lod[i]) { b.setGeometryIdAt(i, G.ids[l][G.var[i]]); G.lod[i] = l; }
  }
}

// ---- (plants2) THE IMPOSTOR BATCH: every species with baked crossed cards (impSculpt.js) draws
// its far instances here — one multi-draw for the whole far field, four triangles a plant
let impB = null, impTex = null, impCap = 0;
function buildImp() {
  const A = assetI, M = A.meta.meta, gs = [...groups.values()].filter(G => M.imp[G.sp] && M.imp[G.sp] === G.nv);
  if (!gs.length || !A.maps.imp) return;
  const geos = [];
  let nvx = 0, nix = 0;
  for (const G of gs) {
    G.impIds = [];
    for (let v = 0; v < G.nv; v++) {
      const src = A.geos['i' + G.sp + '_v' + v], g = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv', 'tangent']) if (src.attributes[k]) g.setAttribute(k, src.attributes[k]);
      g.setIndex(src.index);
      const pos = g.attributes.position, n = pos.count, va = new Float32Array(n * 4);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < n; i++) { lo = Math.min(lo, pos.getY(i)); hi = Math.max(hi, pos.getY(i)); }
      const b0 = Math.max(0, lo), sp = Math.max(1e-4, hi - b0);
      for (let i = 0; i < n; i++) { const h = Math.max(0, (pos.getY(i) - b0) / sp); va[i * 4] = h * h * M.flex[G.sp]; va[i * 4 + 1] = h; }
      g.setAttribute('aVA', new THREE.BufferAttribute(va, 4));
      g.setAttribute('aFlut', new THREE.BufferAttribute(new Float32Array(n), 1));
      g.setAttribute('aBU', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      geos.push([G, v, g]); nvx += n; nix += g.index.count;
    }
    G.impOff = impCap; impCap += G.cap;
  }
  const maps = A.maps.imp;
  let cull = 0;
  for (const G of gs) for (const K of G.hosts) cull = Math.max(cull, K.opts.mat.cull);
  const gz = gs.flatMap(G => G.hosts).find(K => K.opts.mat.glowZ);
  const mat = matFactory({ sway: 1, freq: 0.7, cull, sss: 0.25, def: ['ALPHA', 'SSSL'], key: 'sc-imp', side: THREE.DoubleSide, glowZ: gz ? gz.opts.mat.glowZ : null, sculpt: { map: maps.map, normalMap: maps.normalMap, orm: maps.ormMap } });
  if (maps.normalMap.userData.rg) patchNormalRG(mat);
  impB = new THREE.BatchedMesh(impCap, nvx, nix, mat);
  impB.perObjectFrustumCulled = true; impB.sortObjects = false; impB.frustumCulled = false; impB.name = 'plants:imp';
  for (const [G, v, g] of geos) G.impIds[v] = impB.addGeometry(g);
  for (const G of gs) for (let i = 0; i < G.cap; i++) { impB.addInstance(G.impIds[G.var[i]]); impB.setVisibleAt(G.impOff + i, false); }
  const w = Math.ceil(Math.sqrt(impCap));
  impTex = new THREE.DataTexture(new Float32Array(w * w * 4), w, w, THREE.RGBAFormat, THREE.FloatType);
  impTex.needsUpdate = true;
  mat.userData.uInstTex = { value: impTex };
  for (const G of gs) { G.impB = impB; G.impTex = impTex; }
  root.add(impB);
}

let buildQ = null;
// A throw here must never take the host module down (game.js switches a throwing module off
// for the session): the kit retires itself and the procedural plants keep drawing.
export function plantTick() {
  if (state === 'dead') return;
  try { tick(); } catch (e) {
    console.warn('ABYSSA: plantKit retired, procedural plants kept', e);
    state = 'dead';
    for (const K of keys.values()) if (K.im) K.im.visible = true;
    root.visible = false;
  }
}
// (plants2) the build is a queue of small JOBS run under a per-frame budget (BUILD_MS), not
// one species per frame: the micro-detail texture in slices, every geometry (sway attributes /
// runtime assembly) one at a time, then each batch and each host's mirror. The worst frame of
// the build is now about the budget plus the largest single job.
const BUILD_MS = 4;
function jobsFor(sp, hosts) {
  const S = SPEC[sp], J = [];
  const nv = S.build ? S.nv : assetOf(sp).meta.meta.species[sp].variants;
  for (let v = 0; v < nv; v++) {
    if (S.build) for (let l = 0; l < 3; l++) J.push([sp + ' geo', () => runtimeGeo(sp, v, l)]);
    else { J.push([sp + ' geo', () => pieceGeo(sp, v, false)]); J.push([sp + ' geo', () => pieceGeo(sp, v, true)]); if (assetOf(sp).geos[sp + '_v' + v + '_far2']) J.push([sp + ' geo', () => pieceGeo(sp, v, 2)]); }
  }
  J.push([sp + ' batch', () => buildGroup(sp, hosts)]);
  for (const K of hosts) J.push([sp + ' sync', () => sync(K)]);
  return J;
}
function tick() {
  if (state === 'loaded' && matFactory) {
    if (!buildQ) {
      const by = new Map();
      for (const K of keys.values()) if (hasSpecies(K.species)) { if (!by.has(K.species)) by.set(K.species, []); by.get(K.species).push(K); }
      buildQ = [['micro', () => { if (!microTextureStep(BUILD_MS)) return 'again'; }]];
      for (const [sp, hosts] of by) buildQ.push(...jobsFor(sp, hosts));
      if (assetI) buildQ.push(['imp batch', () => { buildImp(); for (const G of groups.values()) if (G.impB) { if (G.nl < 3) { G.ids.push(G.ids[G.nl - 1]); G.nl = 3; } for (const K of G.hosts) sync(K); } }]);
      return;
    }
    if (buildQ.length) {
      const tb = performance.now();
      while (buildQ.length && performance.now() - tb < BUILD_MS) {
        const [name, fn] = buildQ[0], tj = performance.now();
        if (fn() !== 'again') buildQ.shift();
        const k = name.split(' ')[0], dj = performance.now() - tj;
        buildBy[k] = +((buildBy[k] || 0) + dj).toFixed(1);
        if (dj > jobMax[1]) { jobMax[0] = name; jobMax[1] = +dj.toFixed(1); }
      }
      const ms = performance.now() - tb;
      buildMs += ms; buildMax = Math.max(buildMax, ms); buildFrames++;
      return;
    }
    state = 'compiling';
    renderer.compileAsync(root, camera, scene).then(() => { state = 'ready'; scene.add(root); }).catch(() => { state = 'ready'; scene.add(root); });
  }
  if (state !== 'ready') return;
  const proc = procForced;
  let impAny = false;
  for (const G of groups.values()) {
    let any = false;
    for (const K of G.hosts) {
      if (!K.im) continue;
      if (K.dirty) sync(K);
      // the host's zone gate (its group) is the segment's gate; the host mesh itself goes dark
      const on = !proc && !!(K.im.parent && K.im.parent.visible && K.im.parent.parent);
      K.im.visible = proc;
      if (K.opts.also) for (const o of K.opts.also) o.visible = proc;   // companions (the old pen-tip glow)
      lodPass(G, K, on);
      any = any || on;
    }
    G.batch.visible = any && !G.batch.userData.hide;
    if (G.impB) impAny = impAny || any;
  }
  if (impB) impB.visible = impAny;
}
let buildMax = 0, buildFrames = 0;
const jobMax = ['', 0];
const buildBy = {};

if (typeof window !== 'undefined') window.__plants = {
  state: () => ({
    state, loadMs: +loadMs.toFixed(0), buildMs: +buildMs.toFixed(1), buildMaxFrame: +buildMax.toFixed(1), buildFrames, jobMax, buildBy, ktx2: asset ? asset.ktx2 : null, blades: !!assetB,
    imp: impB ? impCap : 0,
    groups: [...groups.values()].map(G => ({ sp: G.sp, cap: G.cap, hosts: G.hosts.map(K => K.key + ':' + K.n), shown: G.vis.reduce((a, b) => a + (b ? 1 : 0), 0), far: G.lod.reduce((a, b, i) => a + (G.vis[i] === 1 && b >= 1 ? 1 : 0), 0), imp: G.vis.reduce((a, b) => a + (b === 2 ? 1 : 0), 0) }))
  }),
  proc: on => { procForced = !!on; return procForced; },
  lod: on => { lodOn = !!on; for (const G of groups.values()) G.lod.fill(255); return lodOn; },
  groups, root
};
