// Pipeline-built creature assets (tools/blender): one .glb of low meshes + per-set WebP
// maps + a .json of meta. OWNED BY: the sculpt pipeline.
//
//   loadSculpted(base, name) -> Promise<ASSET | null>
//     base 'assets/sleepers/brooder/', name 'brooder'. Never throws: a missing file, a bad
//     decode or no network resolves null, and the caller keeps its procedural build.
//     Cached per base for the page's lifetime (a rebuilt creature costs nothing).
//   ASSET = { geos: { <piece>: BufferGeometry (position, normal, uv, tangent) },
//             maps: { <set>: { map, normalMap, ormMap } },       ormMap: R = AO, G = rough
//             meta: <name>.json (probes, hinges, stats) }
//   assetTextures(a) / assetGeos(a) -> Sets, for a creature's keepTex / keepGeo
//
// Maps are glTF-convention (flipY false: the exporter flips V). Loaded off the critical
// path — the fetch starts when the creature module is imported, the boot never waits.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { maxAniso } from './textures.js';

const CACHE = new Map();
export function loadSculpted(base, name) {
  if (CACHE.has(base)) return CACHE.get(base);
  const p = load(base, name).catch(e => { console.warn('ABYSSA: sculpted asset ' + base + ' unavailable, keeping the procedural build', e && e.message); return null; });
  CACHE.set(base, p);
  return p;
}

async function load(base, name) {
  const t0 = performance.now();
  const meta = await (await fetch(base + name + '.json', { cache: 'force-cache' })).json();
  const gltf = await new GLTFLoader().loadAsync(base + name + '.glb');
  const geos = {};
  gltf.scene.traverse(o => { if (o.isMesh) geos[o.name] = o.geometry; });
  const tl = new THREE.TextureLoader();
  const tex = async (file, srgb) => {
    const t = await tl.loadAsync(base + file);
    t.flipY = false;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = maxAniso();
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  };
  const maps = {};
  await Promise.all(Object.keys(meta.sets).map(async s => {
    const [map, normalMap, ormMap] = await Promise.all([tex(s + '_albedo.webp', true), tex(s + '_normal.webp', false), tex(s + '_orm.webp', false)]);
    maps[s] = { map, normalMap, ormMap };
  }));
  const a = { geos, maps, meta, ms: performance.now() - t0 };
  return a;
}

export function assetTextures(a) {
  const s = new Set();
  if (a) for (const k in a.maps) for (const t of Object.values(a.maps[k])) s.add(t);
  return s;
}
export function assetGeos(a) { return new Set(a ? Object.values(a.geos) : []); }
