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
import { applyMicroDetail, patchNormalRG, microTexture } from '../../lib/microDetail.js';
import { SWAY } from './plantsSculpt.js';

const BASE = 'assets/plants/';
const OFF = typeof location !== 'undefined' && /[?&]plantproc\b/.test(location.search);
let asset = null, state = OFF ? 'off' : 'loading', matFactory = null, procForced = false, lodOn = true;
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
  tube: { near: 14, tint: 0.6, micro: 14, side: F },
  anem: { near: 11, tint: 0.55, micro: 22, side: F },
  barrel: { near: 22, tint: 0.55, micro: 8, side: F },
  worm: { near: 14, tint: 0.25, micro: 18, side: F },
  stag: { near: 15, tint: 0.5, micro: 20, side: F },
  brain: { near: 20, tint: 0.5, micro: 10, side: F },
  table: { near: 20, tint: 0.5, micro: 12, side: F },
  glass: { near: 18, tint: 0.2, micro: 0, side: D2 },
  fan: { near: 18, tint: 0.45, micro: 0, side: D2 },
  crin: { near: 12, tint: 0.5, micro: 0, side: D2 }
};

export function plantAdopt(key, species, im, opts) {
  let K = keys.get(key);
  if (!K) { K = { key, species, opts, im: null, batch: null, dirty: true, ready: false }; keys.set(key, K); }
  K.im = im; K.dirty = true;
  im.userData.plantKey = key; im.userData.plantSp = species;
  return K;
}

if (!OFF) loadSculpted(BASE, 'plants').then(a => {
  loadMs = performance.now() - t0;
  if (!a) { state = 'failed'; return; }
  asset = a; state = 'loaded';
});

// ---- geometry: one prepared BufferGeometry per piece (near + far), sway attributes derived
const _geoCache = new Map();
function pieceGeo(species, v, far) {
  const name = species + '_v' + v + (far ? '_far' : '');   // '_v': assets.js folds a trailing _<digits> (GLTFLoader's de-dup)
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
  const S = SPEC[sp], nv = asset.meta.meta.species[sp].variants;
  const near = [], far = [];
  for (let v = 0; v < nv; v++) { near.push(pieceGeo(sp, v, false)); far.push(pieceGeo(sp, v, true) || pieceGeo(sp, v, false)); }
  let nvx = 0, nix = 0;
  for (const g of near.concat(far)) { nvx += g.attributes.position.count; nix += g.index.count; }
  let cap = 0, cull = 0;
  const def = new Set();
  for (const K of hosts) { K.off = cap; cap += K.opts.cap; cull = Math.max(cull, K.opts.mat.cull); for (const d of K.opts.mat.def || []) def.add(d); }
  const maps = asset.maps[sp], ormB = asset.meta.sets[sp].ormB;
  if (ormB === 'alpha') def.add('ALPHA');
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
  const ids = { near: near.map(g => b.addGeometry(g)), far: far.map(g => b.addGeometry(g)) };
  // sway headroom: per-object culling uses the rest pose's sphere
  for (const id of ids.near.concat(ids.far)) { b.getBoundingSphereAt(id, _sph); const gi = b._geometryInfo && b._geometryInfo[id]; if (gi && gi.boundingSphere) gi.boundingSphere.radius *= 1.35; }
  for (let i = 0; i < cap; i++) { b.addInstance(ids.far[0]); b.setVisibleAt(i, false); }
  // per-instance aInst (phase, amp, shrink, weight) for the shared sway program
  const w = Math.ceil(Math.sqrt(cap));
  const it = new THREE.DataTexture(new Float32Array(w * w * 4), w, w, THREE.RGBAFormat, THREE.FloatType);
  it.needsUpdate = true;
  mat.userData.uInstTex = { value: it };
  const G = {
    sp, hosts, batch: b, ids, nv, instTex: it, cap, near: S.near, S,
    vis: new Uint8Array(cap), lod: new Uint8Array(cap).fill(255), var: new Uint8Array(cap), px: new Float32Array(cap * 3), cull2: new Float32Array(cap), near2: new Float32Array(cap)
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
    b.setMatrixAt(j, _m);
    G.px[j * 3] = _m.elements[12]; G.px[j * 3 + 1] = _m.elements[13]; G.px[j * 3 + 2] = _m.elements[14];
    G.cull2[j] = c2;
    // the near/far switch scales with the instance's own size (a 4 u table holds its detail
    // further out than a 1 u anemone)
    const sy = Math.hypot(_m.elements[4], _m.elements[5], _m.elements[6]), nk = G.near * Math.min(2, Math.max(0.7, sy / 1.6));
    G.near2[j] = nk * nk;
    if (im.instanceColor) im.getColorAt(i, _c); else _c.setRGB(1, 1, 1);
    // soften the host's palette toward its own value: the bake carries the species' colour
    // structure; the tint only varies it (the procedural palettes were tuned for flat albedo)
    const l = 0.2126 * _c.r + 0.7152 * _c.g + 0.0722 * _c.b, k = S.tint;
    const r = l + (_c.r - l) * k, g = l + (_c.g - l) * k, bl = l + (_c.b - l) * k, nrm = 1 / Math.max(0.05, 0.2126 * r + 0.7152 * g + 0.0722 * bl);
    // a gentle share of the host's per-instance brightness jitter (the bake carries the value)
    const lk = Math.min(1.3, Math.max(0.8, 1.02 + 0.8 * (l - 0.3)));
    b.setColorAt(j, _v4.set(r * nrm * lk, g * nrm * lk, bl * nrm * lk, 1));
    td[j * 4] = ai[i * 4]; td[j * 4 + 1] = ai[i * 4 + 1]; td[j * 4 + 2] = ai[i * 4 + 2];
    // w: flora's glow weight, tagged with its zone (gardens.js GD_GLOWZ); gardens hosts' w
    // (a hue/pulse weight only the procedural tips read) is dropped
    td[j * 4 + 3] = K.opts.glowZone != null && ai[i * 4 + 3] > 0 ? 4 * (K.opts.glowZone + 1) + Math.min(3.9, ai[i * 4 + 3]) : 0;
    G.lod[j] = 255;
  }
  for (let i = n; i < K.n; i++) { const j = o + i; if (G.vis[j]) { b.setVisibleAt(j, false); G.vis[j] = 0; } }
  K.n = n;
  G.instTex.needsUpdate = true;
  K.dirty = false;
}

// per host segment: visible = the host's zone gate is open and the instance is inside the
// host's range; near/far by distance
function lodPass(G, K, on) {
  const b = G.batch, cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  const P = G.px, N2 = G.near2;
  for (let i = K.off, e = K.off + K.n; i < e; i++) {
    let vis = 0;
    if (on) { const dx = P[i * 3] - cx, dy = P[i * 3 + 1] - cy, dz = P[i * 3 + 2] - cz, d2 = dx * dx + dy * dy + dz * dz; vis = d2 < G.cull2[i] ? 1 : 0;
      if (vis) { const l = (lodOn && d2 > N2[i]) ? 1 : 0; if (l !== G.lod[i]) { b.setGeometryIdAt(i, l ? G.ids.far[G.var[i]] : G.ids.near[G.var[i]]); G.lod[i] = l; } } }
    if (vis !== G.vis[i]) { b.setVisibleAt(i, !!vis); G.vis[i] = vis; }
  }
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
function tick() {
  if (state === 'loaded' && matFactory) {
    // one species per frame (geometry prep + batch upload), then compile every program
    // off-screen with compileAsync; nothing shows until all of it is ready
    if (!buildQ) {
      // the shared micro-detail texture (if no sleeper has made it yet) gets a frame of its own
      const tm = performance.now();
      microTexture();
      buildBy.micro = +(performance.now() - tm).toFixed(1);
      const by = new Map();
      for (const K of keys.values()) if (SPEC[K.species] && asset.geos[K.species + '_v0']) { if (!by.has(K.species)) by.set(K.species, []); by.get(K.species).push(K); }
      buildQ = [...by.entries()];
      return;
    }
    if (buildQ.length) {
      const tb = performance.now(), [sp, hosts] = buildQ.shift();
      buildGroup(sp, hosts);
      for (const K of hosts) sync(K);
      const ms = performance.now() - tb;
      buildMs += ms; buildMax = Math.max(buildMax, ms); buildBy[sp] = +ms.toFixed(1);
      return;
    }
    state = 'compiling';
    renderer.compileAsync(root, camera, scene).then(() => { state = 'ready'; scene.add(root); }).catch(() => { state = 'ready'; scene.add(root); });
  }
  if (state !== 'ready') return;
  const proc = procForced;
  for (const G of groups.values()) {
    let any = false;
    for (const K of G.hosts) {
      if (!K.im) continue;
      if (K.dirty) sync(K);
      // the host's zone gate (its group) is the segment's gate; the host mesh itself goes dark
      const on = !proc && !!(K.im.parent && K.im.parent.visible && K.im.parent.parent);
      K.im.visible = proc;
      lodPass(G, K, on);
      any = any || on;
    }
    G.batch.visible = any && !G.batch.userData.hide;
  }
}
let buildMax = 0;
const buildBy = {};

if (typeof window !== 'undefined') window.__plants = {
  state: () => ({
    state, loadMs: +loadMs.toFixed(0), buildMs: +buildMs.toFixed(1), buildMaxFrame: +buildMax.toFixed(1), buildBy, ktx2: asset ? asset.ktx2 : null,
    groups: [...groups.values()].map(G => ({ sp: G.sp, cap: G.cap, hosts: G.hosts.map(K => K.key + ':' + K.n), shown: G.vis.reduce((a, b) => a + b, 0), far: G.lod.reduce((a, b, i) => a + (G.vis[i] && b === 1 ? 1 : 0), 0) }))
  }),
  proc: on => { procForced = !!on; return procForced; },
  lod: on => { lodOn = !!on; for (const G of groups.values()) G.lod.fill(255); return lodOn; },
  groups, root
};
