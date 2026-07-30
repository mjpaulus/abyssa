// glTF prop loader. OWNED BY: asset-pipeline agent.
//
// EXPORTS
//   loadProp(url) -> Promise<{ geometry, material } | null>
//     Loads a .glb, merges every mesh under it into ONE indexed BufferGeometry and
//     ONE material so the result is directly instanceable. Resolves to null (never
//     throws) if the file is missing or unreadable, so callers can degrade quietly.
//     Geometry is normalised: XZ centred, base at y=0, largest extent = 1 world unit,
//     so a caller scales purely in world units.
//   PROP_UNIT — the normalised size (1), for documentation of the above contract.
//   disposeProp(p) — frees a loaded prop.
//
// Multi-material source meshes are flattened by baking each primitive's base colour
// into a vertex-colour attribute; a single-material textured mesh keeps its map.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PROP_UNIT = 1;

const DRACO_PATH = 'https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/';

let _loader = null;
function loader() {
  if (_loader) return _loader;
  _loader = new GLTFLoader();
  try {
    const d = new DRACOLoader();
    d.setDecoderPath(DRACO_PATH);
    d.setDecoderConfig({ type: 'js' });
    _loader.setDRACOLoader(d);
  } catch (e) { /* DRACO is optional: uncompressed .glb still loads */ }
  return _loader;
}

// Keep only the attributes mergeGeometries can reconcile across primitives.
const KEEP = ['position', 'normal', 'uv', 'color'];

function prep(geo, mat, wantUV, bakeColor) {
  const g = geo.index ? geo.clone() : geo.clone().toNonIndexed();
  for (const name of Object.keys(g.attributes)) if (!KEEP.includes(name)) g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (wantUV && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!wantUV && g.attributes.uv) g.deleteAttribute('uv');
  if (bakeColor) {
    // Bake the primitive's base colour so N materials collapse to 1.
    const src = g.attributes.color, arr = new Float32Array(n * 3);
    const c = (mat && mat.color) ? mat.color : new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r * (src ? src.getX(i) : 1);
      arr[i * 3 + 1] = c.g * (src ? src.getY(i) : 1);
      arr[i * 3 + 2] = c.b * (src ? src.getZ(i) : 1);
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  } else if (g.attributes.color) g.deleteAttribute('color');
  if (!g.index) {
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return g;
}

function flatten(root) {
  const parts = [];
  root.updateWorldMatrix(true, true);
  root.traverse(o => {
    // Embedded lights/cameras are authored for the source scene's exposure; drop them.
    if (o.isLight || o.isCamera) { if (o.parent) o.parent.remove(o); return; }
    if (!o.isMesh || !o.geometry) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = o.geometry.groups && o.geometry.groups.length ? o.geometry.groups : null;
    if (!groups || mats.length < 2) {
      parts.push({ geo: o.geometry, mat: mats[0], world: o.matrixWorld });
    } else {
      for (const gr of groups) {
        const sub = o.geometry.clone();
        sub.clearGroups();
        const start = gr.start, count = gr.count;
        const idx = sub.index ? sub.index.array.slice(start, start + count) : null;
        if (idx) sub.setIndex(Array.from(idx));
        parts.push({ geo: sub, mat: mats[gr.materialIndex] || mats[0], world: o.matrixWorld, tmp: true });
      }
    }
  });
  return parts;
}

export async function loadProp(url) {
  let gltf;
  try {
    gltf = await loader().loadAsync(url);
  } catch (e) {
    console.warn('[assets] prop failed:', url, e && e.message);
    return null;
  }
  try {
    const parts = flatten(gltf.scene);
    if (!parts.length) return null;

    // Keep a texture only when the whole prop shares one textured material —
    // otherwise UV sets from different materials would collide in the merge.
    const first = parts[0].mat;
    const uniform = parts.every(p => p.mat === first);
    const map = uniform && first && first.map ? first.map : null;
    const bake = !map;

    const geos = [];
    for (const p of parts) {
      const g = prep(p.geo, p.mat, !!map, bake);
      g.applyMatrix4(p.world);
      geos.push(g);
      if (p.tmp) p.geo.dispose();
    }
    let geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!geometry) { for (const g of geos) g.dispose(); return null; }
    if (geos.length > 1) for (const g of geos) g.dispose();

    // Normalise: XZ centred, base on y=0, largest extent one world unit.
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox, size = new THREE.Vector3();
    bb.getSize(size);
    const s = 1 / Math.max(1e-4, Math.max(size.x, size.y, size.z));
    geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    geometry.scale(s, s, s);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: bake, map, roughness: 0.9, metalness: 0.02,
      flatShading: bake && !geometry.attributes.uv
    });
    if (map) { map.colorSpace = THREE.SRGBColorSpace; map.needsUpdate = true; }

    geometry.userData.tris = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
    geometry.userData.srcSize = size;
    return { geometry, material };
  } catch (e) {
    console.warn('[assets] prop merge failed:', url, e && e.message);
    return null;
  }
}

export function disposeProp(p) {
  if (!p) return;
  if (p.geometry) p.geometry.dispose();
  if (p.material) { if (p.material.map) p.material.map.dispose(); p.material.dispose(); }
}
