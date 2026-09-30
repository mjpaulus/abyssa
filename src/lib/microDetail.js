// MICRO DETAIL — a shared, generated, TILEABLE surface layer for sculpted creatures.
// OWNED BY: the sculpt pipeline (brooder2). Any sleeper can use it.
//
// Why: a baked atlas spreads its texels over the whole creature (Velkath's 2048 shell covers
// ~1400 square units at ~39 texels per unit), so at 1-3 units the shell reads as smooth
// putty however good the bake. This adds the grain the atlas cannot hold: calcified
// granules, pinhole pits and hairline cracks from one small periodic texture, projected
// TRIPLANAR in the mesh's OWN (pre-instance) object space so it sticks to the animal as
// it walks, and MASKED BY THE BAKED MAPS so it follows the sculpt instead of floating
// over it: ORM.B cavity (tools/blender/bake.py) and ORM.R occlusion put grit in the
// crevices and polish on the worn convex edges. It FADES by screen footprint (fwidth of
// the tile coordinate): once a feature is under a pixel it is gone, so there is no
// shimmer and at game distance the material is exactly the baked one (and the texture
// fetches are skipped by a uniform-coherent branch).
//
//   applyMicroDetail(material, opts) -> material   chains onBeforeCompile / program key
//     opts: scale  tiles per object unit (default 20: a 0.77 u tile on a 15.4 u shell)
//           normal detail normal strength (0.55), cavity albedo darkening (0.35),
//           rough  roughness modulation (0.25), fade [lo, hi] footprint in tiles per
//           pixel (default [0.012, 0.045]), cav: true when ORM.B carries cavity
//   microTexture() -> the shared DataTexture (256^2 RGBA8, mipmapped, repeat)
//                     R,G = tangent normal XY, B = height (1 = up), A = roughness offset
//   MICRO.on = { value: 1 }   one uniform for every program (window.__micro A/B)
//   patchNormalRG(material)  -> rebuild Z for two-channel (BC5) normal maps
//
// Cost: generation ~15-30 ms once, 256 KB (+mips) of GPU memory for every creature.
// Fragment: 3 fetches + ~40 ALU where it is on; zero fetches where the fade is 0.
import * as THREE from 'three';

export const MICRO = { on: { value: 1 } };
const N = 256;
let TEX = null;

// ---- the texture: periodic noise, deterministic ----------------------------------------
function hash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const wrap = (a, C) => ((a % C) + C) % C;
const _w = { f1: 0, f2: 0, id: 0 };
function worley(u, v, C, s) {
  const x = u * C, y = v * C, X = Math.floor(x), Y = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = X + dx, cy = Y + dy, wx = wrap(cx, C), wy = wrap(cy, C);
    const d = Math.hypot(cx + hash(wx, wy, s) - x, cy + hash(wx, wy, s + 1) - y);
    if (d < f1) { f2 = f1; f1 = d; id = hash(wx, wy, s + 2); } else if (d < f2) f2 = d;
  }
  _w.f1 = f1; _w.f2 = f2; _w.id = id;
  return _w;
}
function vnoise(u, v, C, s) {
  const x = u * C, y = v * C, X = Math.floor(x), Y = Math.floor(y), fx = x - X, fy = y - Y;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(wrap(X, C), wrap(Y, C), s), b = hash(wrap(X + 1, C), wrap(Y, C), s);
  const c = hash(wrap(X, C), wrap(Y + 1, C), s), d = hash(wrap(X + 1, C), wrap(Y + 1, C), s);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
const sst = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function microTexture() {
  if (TEX) return TEX;
  const t0 = performance.now();
  const H = new Float32Array(N * N), Rg = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = i / N, v = j / N;
    // calcified grain: four periodic octaves
    const grain = (vnoise(u, v, 16, 11) - 0.5) + 0.5 * (vnoise(u, v, 32, 12) - 0.5) + 0.25 * (vnoise(u, v, 64, 13) - 0.5) + 0.125 * (vnoise(u, v, 128, 14) - 0.5);
    // granules and pinholes on one cell field: most cells a rounded granule, some a pit
    let w = worley(u, v, 22, 21), gran = 0, pit = 0;
    if (w.id > 0.30) gran = Math.pow(Math.max(0, 1 - w.f1 / (0.42 + 0.18 * w.id)), 2);
    else if (w.id < 0.16) pit = 1 - sst(0.0, 0.30, w.f1);
    // fine pinholes
    w = worley(u, v, 52, 31);
    const fine = w.id < 0.28 ? 1 - sst(0.0, 0.32, w.f1) : 0;
    // hairline cracks, only in patches
    w = worley(u, v, 5, 41);
    const crack = (1 - sst(0.0, 0.035, w.f2 - w.f1)) * sst(0.45, 0.6, vnoise(u, v, 4, 42));
    H[j * N + i] = 0.30 * grain + 0.55 * gran - 0.9 * pit - 0.45 * fine - 0.8 * crack;
    Rg[j * N + i] = 0.35 * (pit + crack) + 0.2 * fine - 0.25 * gran + 0.2 * grain;
  }
  // slopes, normalised so the 95th-percentile slope is ~1 (a detail layer with character,
  // which applyMicroDetail's strength then scales)
  const G = new Float32Array(N * N * 2), mags = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const gx = (H[j * N + wrap(i + 1, N)] - H[j * N + wrap(i - 1, N)]) * 0.5, gy = (H[wrap(j + 1, N) * N + i] - H[wrap(j - 1, N) * N + i]) * 0.5;
    G[(j * N + i) * 2] = gx; G[(j * N + i) * 2 + 1] = gy; mags[j * N + i] = Math.hypot(gx, gy);
  }
  const srt = Float32Array.from(mags).sort(), k = 1 / Math.max(1e-6, srt[Math.floor(N * N * 0.95)]);
  let hmin = 1e9, hmax = -1e9;
  for (let i = 0; i < N * N; i++) { if (H[i] < hmin) hmin = H[i]; if (H[i] > hmax) hmax = H[i]; }
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const nx = -G[i * 2] * k, ny = -G[i * 2 + 1] * k, l = Math.hypot(nx, ny, 1);
    data[i * 4] = Math.round((nx / l * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round((H[i] - hmin) / (hmax - hmin) * 255);
    data[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, 0.5 + Rg[i])) * 255);
  }
  TEX = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  TEX.wrapS = TEX.wrapT = THREE.RepeatWrapping;
  TEX.magFilter = THREE.LinearFilter;
  TEX.minFilter = THREE.LinearMipmapLinearFilter;
  TEX.generateMipmaps = true;
  TEX.anisotropy = 4;
  TEX.colorSpace = THREE.NoColorSpace;
  TEX.needsUpdate = true;
  TEX.userData.genMs = performance.now() - t0;
  return TEX;
}

// ---- the shader patch ---------------------------------------------------------------------
// the TAA mip bias macro (postfx.taa.js), include-guarded so it composes with the map chunks
const TAA_TEX = `
#ifndef ABYSSA_TAA_DECL
#define ABYSSA_TAA_DECL
#ifdef USE_FOG
uniform vec4 abyssaTaa;
#define ABYSSA_TEX( t, uv ) texture( t, uv, abyssaTaa.x )
#else
#define ABYSSA_TEX( t, uv ) texture2D( t, uv )
#endif
#endif
`;
const VERT_PARS = `
varying vec3 vMdP;
varying vec3 vMdX;
varying vec3 vMdY;
varying vec3 vMdZ;
uniform vec4 uMdParams;
`;
const VERT_MAIN = `
vMdP = transformed * uMdParams.x;
{
  mat3 mdM = mat3( modelViewMatrix );
  #ifdef USE_INSTANCING
    mdM = mdM * mat3( instanceMatrix );
  #endif
  vMdX = mdM[ 0 ]; vMdY = mdM[ 1 ]; vMdZ = mdM[ 2 ];
}
`;
const FRAG_PARS = TAA_TEX + `
varying vec3 vMdP;
varying vec3 vMdX;
varying vec3 vMdY;
varying vec3 vMdZ;
uniform sampler2D uMdTex;
uniform vec4 uMdParams;
uniform vec3 uMdFade;
uniform float uMdOn;
`;
// after normal_fragment_maps: roughnessFactor and diffuseColor are still ahead of the
// lights (lights_physical_fragment reads both), so all three terms land here
const FRAG_MAIN = `
{
  vec3 mdFw = fwidth( vMdP );
  float mdFoot = max( max( mdFw.x, mdFw.y ), mdFw.z );
  float mdFade = ( 1.0 - smoothstep( uMdFade.x, uMdFade.y, mdFoot ) ) * uMdOn;
  if ( mdFade > 0.002 ) {
    mat3 mdM = mat3( normalize( vMdX ), normalize( vMdY ), normalize( vMdZ ) );
    vec3 mdNg = normalize( transpose( mdM ) * ( normalize( vNormal ) * faceDirection ) );
    vec3 mdBw = pow( abs( mdNg ), vec3( 4.0 ) );
    mdBw /= ( mdBw.x + mdBw.y + mdBw.z );
    vec4 mdTx = ABYSSA_TEX( uMdTex, vMdP.zy );
    vec4 mdTy = ABYSSA_TEX( uMdTex, vMdP.xz + vec2( 0.37, 0.71 ) );
    vec4 mdTz = ABYSSA_TEX( uMdTex, vMdP.xy + vec2( 0.53, 0.19 ) );
    // whiteout/UDN triplanar: each plane's slope rides the geometric normal (height is a
    // scalar on the surface, so the tangent gradient needs no per-face sign)
    vec2 mdDx = mdTx.xy * 2.0 - 1.0, mdDy = mdTy.xy * 2.0 - 1.0, mdDz = mdTz.xy * 2.0 - 1.0;
    vec3 mdOff = vec3( 0.0, mdDx.y, mdDx.x ) * mdBw.x + vec3( mdDy.x, 0.0, mdDy.y ) * mdBw.y + vec3( mdDz.x, mdDz.y, 0.0 ) * mdBw.z;
    float mdH = dot( vec3( mdTx.b, mdTy.b, mdTz.b ), mdBw );
    float mdR = dot( vec3( mdTx.a, mdTy.a, mdTz.a ), mdBw ) - 0.5;
    // the baked maps say where the detail belongs
    float mdCav = 0.5, mdAo = 1.0;
    #ifdef USE_AOMAP
      vec4 mdOrm = texture2D( aoMap, vAoMapUv );
      mdAo = mdOrm.r;
      if ( uMdFade.z > 0.5 ) mdCav = mdOrm.b;
    #endif
    float mdCrev = clamp( ( mdCav - 0.5 ) * 2.5, 0.0, 1.0 ), mdEdge = clamp( ( 0.5 - mdCav ) * 2.5, 0.0, 1.0 );
    float mdDeep = 1.0 - smoothstep( 0.35, 0.85, mdAo );
    float mdGrit = max( mdCrev, mdDeep );
    // worn convex edges are polished smooth; crevices carry the full grit
    float mdN = uMdParams.y * mdFade * ( 1.0 - 0.5 * mdEdge ) * ( 1.0 + 0.3 * mdGrit );
    normal = normalize( normal + mdM * mdOff * mdN );
    float mdPit = 1.0 - mdH;
    diffuseColor.rgb *= clamp( 1.0 - uMdParams.z * mdFade * ( mdPit * ( 0.45 + 0.55 * mdGrit ) - 0.25 * mdEdge * mdH ), 0.0, 1.2 );
    roughnessFactor = clamp( roughnessFactor + uMdParams.w * mdFade * ( mdR + 0.2 * mdGrit - 0.2 * mdEdge ), 0.04, 1.0 );
  }
}
`;

const NFM_END = '// ABYSSA normal_fragment_maps end';
function chain(m, tag, fn) {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  const prevSrc = prev && prev !== THREE.Material.prototype.onBeforeCompile ? prev.toString().length + ':' + prev.toString().slice(0, 64) : '';
  const baseKey = m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? prevKey.call(m) : '';
  m.onBeforeCompile = function (sh, r) { if (prev) prev.call(this, sh, r); fn(sh, r); };
  m.customProgramCacheKey = () => baseKey + '|' + prevSrc + '|' + tag;
  return m;
}

export function applyMicroDetail(m, o = {}) {
  const f = o.fade || [0.012, 0.045];
  const U = {
    uMdTex: { value: microTexture() },
    uMdParams: { value: new THREE.Vector4(o.scale != null ? o.scale : 20, o.normal != null ? o.normal : 0.55, o.cavity != null ? o.cavity : 0.35, o.rough != null ? o.rough : 0.25) },
    uMdFade: { value: new THREE.Vector3(f[0], f[1], o.cav ? 1 : 0) },
    uMdOn: MICRO.on
  };
  m.userData.micro = U;
  return chain(m, 'abyssa-micro1', sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS);
    // after the normal chunk, whether it is still an include or patchNormalRG expanded it
    const at = sh.fragmentShader.indexOf('#include <normal_fragment_maps>') >= 0 ? '#include <normal_fragment_maps>' : NFM_END;
    sh.fragmentShader = sh.fragmentShader.replace(at, at + '\n' + FRAG_MAIN);
  });
}

// Two-channel normal maps (BC5/RGTC2 from tools/blender/ktx2.mjs): B arrives as 0, so the
// tangent normal's Z is rebuilt from XY before normalScale.
export function patchNormalRG(m) {
  return chain(m, 'abyssa-nrg', sh => {
    const src = THREE.ShaderChunk.normal_fragment_maps;
    const a = 'mapN.xy *= normalScale;';
    if (src.indexOf(a) < 0) { console.warn('microDetail: normal_fragment_maps did not match; RG normals left as-is'); return; }
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', src.replace(a, 'mapN.z = sqrt( max( 0.0, 1.0 - dot( mapN.xy, mapN.xy ) ) );\n\t' + a) + '\n' + NFM_END);
  });
}

if (typeof window !== 'undefined') {
  window.__micro = {
    on: v => { MICRO.on.value = v ? 1 : 0; return MICRO.on.value; },
    state: () => ({ on: MICRO.on.value, genMs: TEX ? +TEX.userData.genMs.toFixed(1) : null })
  };
}
