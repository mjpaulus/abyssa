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
//
// COMPRESSION (brooder2; additive — an asset whose .json has no `compress` loads exactly
// as before). meta.compress = { mesh: 'draco', tex: 'ktx2' } from the creature's pipeline:
//   mesh 'draco': the .glb is Draco-compressed; three's DRACOLoader decodes it in workers,
//     its decoder fetched from the importmap's own three/addons (libs/draco/gltf/)
//   tex 'ktx2': <set>_albedo/_normal.ktx2 (tools/blender/ktx2.mjs: BC1 sRGB, BC5, zstd; ORM
//     stays WebP)
//     are used when the GPU has S3TC (+sRGB) and RGTC; otherwise, per map on any error, and
//     under ?noktx, the WebP. A BC5 normal carries userData.rg: the material must rebuild Z
//     (lib/microDetail.js patchNormalRG).
// a.ms is fetch + parse + decode (the WebP path decodes at first upload, so it looks cheap
// here and pays at render; the KTX2 path is already GPU-format and uploads as-is).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { maxAniso } from './textures.js';

let DRACO = null, KTX2 = null, BC = null;
function draco() {
  if (!DRACO) {
    DRACO = new DRACOLoader();
    DRACO.setDecoderPath(import.meta.resolve('three/addons/libs/draco/gltf/'));
    DRACO.setWorkerLimit(2);
  }
  return DRACO;
}
// raw block-compressed KTX2 needs no transcoder; the loader only wants a config object
function ktx2() {
  if (!KTX2) {
    KTX2 = new KTX2Loader();
    KTX2.workerConfig = { astcSupported: false, astcHDRSupported: false, etc1Supported: false, etc2Supported: false, dxtSupported: true, bptcSupported: false, pvrtcSupported: false };
  }
  return KTX2;
}
// S3TC + its sRGB variant + RGTC, probed once on a throwaway context (this module is also
// used by sculptlab.html, so it cannot reach for the game's renderer)
export function bcSupported() {
  if (BC !== null) return BC;
  BC = false;
  try {
    if (typeof location !== 'undefined' && location.search.includes('noktx')) return BC;
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) {
      BC = !!(gl.getExtension('WEBGL_compressed_texture_s3tc') && gl.getExtension('WEBGL_compressed_texture_s3tc_srgb') && gl.getExtension('EXT_texture_compression_rgtc'));
      const lc = gl.getExtension('WEBGL_lose_context');
      if (lc) lc.loseContext();
    }
  } catch (e) { BC = false; }
  return BC;
}

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
  const comp = meta.compress || {};
  const gl = new GLTFLoader();
  if (comp.mesh === 'draco') gl.setDRACOLoader(draco());
  const gltf = await gl.loadAsync(base + name + '.glb');
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
  const useKtx = comp.tex === 'ktx2' && bcSupported();
  const ktex = async (file, srgb, rg) => {
    try {
      const t = await ktx2().loadAsync(base + file + '.ktx2');
      t.anisotropy = maxAniso();
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.userData.rg = !!rg;
      t.userData.ktx2 = true;
      return t;
    } catch (e) {
      console.warn('ABYSSA: ' + file + '.ktx2 failed, using the WebP', e && e.message);
      return tex(file + '.webp', srgb);
    }
  };
  const maps = {};
  await Promise.all(Object.keys(meta.sets).map(async s => {
    const [map, normalMap, ormMap] = useKtx
      ? await Promise.all([ktex(s + '_albedo', true), ktex(s + '_normal', false, true), tex(s + '_orm.webp', false)])
      : await Promise.all([tex(s + '_albedo.webp', true), tex(s + '_normal.webp', false), tex(s + '_orm.webp', false)]);
    maps[s] = { map, normalMap, ormMap };
  }));
  const a = { geos, maps, meta, ms: performance.now() - t0, ktx2: useKtx };
  return a;
}

export function assetTextures(a) {
  const s = new Set();
  if (a) for (const k in a.maps) for (const t of Object.values(a.maps[k])) s.add(t);
  return s;
}
export function assetGeos(a) { return new Set(a ? Object.values(a.geos) : []); }
