// THE OLD HARPOON'S MODEL (fissure-and-harpoon Task 6; shared with Task 7's blade). A neutral module:
// it imports nothing from the sleepers or Sal, so any owner (sleeper/harpoon.js lodged in Velkath, Sal's
// hand) can take it without an import cycle.
//
//   HARPOON_ASSET   the sculpted set (src/lib/harpoonSculpt.js -> tools/blender -> assets/harpoon), asked for
//                   at import, so it sits in sculptedLedger() and the boot waits for it
//   harpoonModel()  -> { geometry, material, sculpted, dim, meta, keepGeo: Set, keepTex: Set }
//   harpoonSculpted() -> true once the sculpted set has landed
// The geometry and maps are SHARED for the page's life: an owner that disposes its subtree must keep them
// (the sets returned). The material is the caller's own (fresh per call; one program per kind via
// customProgramCacheKey). Without the asset: the procedural build from the same DIM (the loader never throws).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { envTexDeep as envTex } from '../core.js';
import { V3 } from './math.js';
import { loadSculpted, assetTextures, assetGeos } from './assets.js';
import { DIM } from './harpoonSculpt.js';

export const HARPOON_ASSET = loadSculpted('assets/harpoon/', 'harpoon');
let ASSET = null;
HARPOON_ASSET.then(a => { if (a && a.geos.harpoon && a.maps.harpoon) ASSET = a; });
export const harpoonSculpted = () => !!ASSET;

// ---- THE MODEL (shared with Task 7) ----------------------------------------------------------
let _procGeo = null;
// The procedural build: the same proportions in lathes, cones and boxes, vertex-coloured (iron,
// brass, weathered wood, tarred line). The loader never throws; this is what draws until (or unless)
// the sculpted set lands.
function proceduralGeo() {
  if (_procGeo) return _procGeo;
  const D = DIM, parts = [];
  const col = (g, c) => {
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c[0] ** 2.2; a[i * 3 + 1] = c[1] ** 2.2; a[i * 3 + 2] = c[2] ** 2.2; }   // (sRGB swatches, linear vertex colours)
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g.index ? g.toNonIndexed() : g;
  };
  const along = (g, z0, z1) => { g.rotateX(Math.PI / 2); g.translate(0, 0, (z0 + z1) / 2); return g; };
  const IRON = [0.17, 0.12, 0.09], BRASS = [0.52, 0.40, 0.21], WOOD = [0.40, 0.38, 0.33], ROPE = [0.13, 0.11, 0.08];
  parts.push(col(along(new THREE.CylinderGeometry(D.poleR0, D.poleR1, D.fer0 - D.butt, 12, 1), D.butt, D.fer0), WOOD));
  parts.push(col(along(new THREE.CylinderGeometry(D.ferR - 0.003, D.ferR, D.fer1 - D.fer0, 14, 1), D.fer0, D.fer1), BRASS));
  for (const z of [D.fer0 + 0.008, D.fer1 - 0.01]) { const g = new THREE.TorusGeometry(D.ferR, 0.0062, 6, 16); g.translate(0, 0, z); parts.push(col(g, BRASS)); }
  parts.push(col(along(new THREE.CylinderGeometry(D.shankR + 0.002, D.socketR, D.shank0 + 0.012 - D.socket0 + 0.02, 10, 1), D.socket0 - 0.02, D.shank0 + 0.012), IRON));
  { const g = new THREE.BoxGeometry(D.shankR * 2, D.shankR * 2, D.pin - D.shank0); g.translate(0, 0, (D.shank0 + D.pin) / 2); parts.push(col(g, IRON)); }
  { // the head: a flat two-flued leaf (an extruded outline), canted on its pin
    const sh = new THREE.Shape();
    const P = [[0, D.tip], [0.070, 0.508], [D.headHalfW, D.barbBack], [0.046, 0.469], [0.019, 0.462], [-0.019, 0.462], [-0.046, 0.469], [-D.headHalfW, D.barbBack], [-0.070, 0.508]];
    sh.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i < P.length; i++) sh.lineTo(P[i][0], P[i][1]);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: false });
    g.translate(0, 0, -0.006);
    g.rotateX(Math.PI / 2);                  // the outline's y -> +Z (the point), its depth -> Y (the leaf's thickness)
    g.translate(0, 0, -D.pin); g.rotateY(-D.toggle); g.translate(0, 0, D.pin);   // the toggle's cant on its pin
    parts.push(col(g, IRON));
  }
  for (let k = 0; k < 3; k++) { const g = new THREE.TorusGeometry(D.poleR0 + D.lashR * 0.75, D.lashR, 6, 14); g.translate(0, 0, D.lash0 + (D.lash1 - D.lash0) * (k + 0.5) / 3); parts.push(col(g, ROPE)); }
  {
    const c = new THREE.CubicBezierCurve3(V3(0.040, -0.022, -0.172), V3(0.072, -0.085, -0.215), V3(0.070, -0.165, -0.268), V3(0.052, -0.215, -0.318));
    parts.push(col(new THREE.TubeGeometry(c, 8, 0.0105, 6, false), ROPE));
  }
  for (const p of parts) { if (p.attributes.uv === undefined) p.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2)); }
  _procGeo = mergeGeometries(parts.map(p => { const g = new THREE.BufferGeometry(); for (const k of ['position', 'normal', 'uv', 'color']) g.setAttribute(k, p.attributes[k]); return g; }));
  _procGeo.computeBoundingSphere();
  return _procGeo;
}
// harpoonModel() -> { geometry, material, sculpted, dim, keepGeo: Set, keepTex: Set }
// The geometry and textures are SHARED (cached for the page's life): an owner that disposes its
// subtree must keep them (the sets returned; a sleeper's L.keepGeo / L.keepTex). The material is the
// caller's own (fresh per call; one program for every owner: customProgramCacheKey).
export function harpoonModel() {
  if (ASSET) {
    const mp = ASSET.maps.harpoon;
    const m = new THREE.MeshStandardMaterial({
      map: mp.map, normalMap: mp.normalMap, roughnessMap: mp.ormMap, aoMap: mp.ormMap, metalnessMap: mp.ormMap,
      roughness: 1, metalness: 1, aoMapIntensity: 0.85, envMap: envTex, envMapIntensity: 0.55
    });
    m.customProgramCacheKey = () => 'harpoon|sculpt';
    return { geometry: ASSET.geos.harpoon, material: m, sculpted: true, dim: DIM, meta: ASSET.meta.meta, keepGeo: assetGeos(ASSET), keepTex: assetTextures(ASSET) };
  }
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.35, envMap: envTex, envMapIntensity: 0.45 });
  m.customProgramCacheKey = () => 'harpoon|proc';
  const g = proceduralGeo();
  return { geometry: g, material: m, sculpted: false, dim: DIM, meta: null, keepGeo: new Set([g]), keepTex: new Set() };
}

