// TEMPORAL ANTI-ALIASING + TEMPORAL UPSCALING (TAAU). OWNED BY: orchestrator (postfx).
//
// The scene and the whole composer chain (AO, shafts, DoF, bloom, grade) render at the
// INTERNAL resolution with a sub-pixel Halton(2,3) jitter on the projection. This pass is
// the LAST in the composer: it reconstructs the jittered internal frame into an OUTPUT-
// resolution history (ping-pong, HalfFloat, no depth attachments), then draws the output
// finish (RCAS sharpen, vignette, shadow grain + dither) to the canvas. SMAA, vignette and
// grain leave the chain while this runs; the old SMAA pass is the kill-switch path.
//
// Resolve, per output pixel:
//   1. 3x3 internal texels around the pixel's position in the jittered image, Blackman-
//      Harris (exp(-2.29 d^2)) weights in INTERNAL pixel units -> the current sample. The
//      same taps give YCoCg moments + min/max for the history clip.
//   2. Closest depth of the 3x3 (edge dilation) -> CAMERA reprojection (the world is
//      treated as static: prev VP x inverse current VP, both unjittered). The scene's
//      animals are vertex-shader animated and cannot publish velocities; their history is
//      rejected by the variance clip instead (measured, see roadmap/ notes in the commit).
//   3. History: Catmull-Rom (5 bilinear taps) at the reprojected uv. Disocclusion: the
//      history's ALPHA stores each pixel's view distance; the reprojection predicts the
//      previous view distance, and a 2x2 neighbourhood that disagrees by more than a few
//      percent rejects the history outright.
//   4. Variance clip (Salvi) intersected with the min/max box, clip toward the current
//      sample (Playdead), then a luminance-weighted (Karis) blend. The current weight is
//      scaled by how close the nearest real sample fell to the pixel centre, so under
//      upscaling a pixel is not overwritten by a sample that landed a pixel away.
//
// Zero per-frame allocation: matrices, vectors and the Halton table are module scoped.
// No backticks inside GLSL comments (they terminate the template literal).
import * as THREE from 'three';
import { Pass } from 'postprocessing';
import { SURFACE_Y } from './config.js';
import { OCEAN_GLSL_DISP, OCEAN_GLSL_DISP_PREV, OCEAN_UNIFORMS, uOcDispPrev, uOcVelK, buildOceanGeometry, GRID_LEVELS, oceanReady } from './world/ocean.js';

// TEXTURE MIP BIAS under upscaling. abyssaTaa (installed by world/water.js patchFog on
// every fogged program, the abyssaAir way) carries x = LOD bias; the built-in map chunks
// sample through ABYSSA_TEX, which applies it only where the uniform exists (USE_FOG).
// The declaration rides the map pars chunks behind an include guard, so any order or
// repetition of the chunks (and lib/triplanar.js, which carries the same guard) is safe.
export const TAA_TEX_DECL = `
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
(function patchMipBias() {
  const C = THREE.ShaderChunk;
  for (const k of ['map_pars_fragment', 'normalmap_pars_fragment', 'roughnessmap_pars_fragment', 'metalnessmap_pars_fragment', 'emissivemap_pars_fragment']) {
    if (typeof C[k] === 'string') C[k] = TAA_TEX_DECL + C[k];
  }
  const rep = (k, a, b) => {
    const t = C[k];
    if (typeof t !== 'string' || t.indexOf(a) < 0) { console.warn('TAA mip bias: chunk ' + k + ' did not match; left unbiased'); return; }
    C[k] = t.split(a).join(b);
  };
  rep('map_fragment', 'texture2D( map, vMapUv )', 'ABYSSA_TEX( map, vMapUv )');
  rep('normal_fragment_maps', 'texture2D( normalMap, vNormalMapUv )', 'ABYSSA_TEX( normalMap, vNormalMapUv )');
  rep('roughnessmap_fragment', 'texture2D( roughnessMap, vRoughnessMapUv )', 'ABYSSA_TEX( roughnessMap, vRoughnessMapUv )');
  rep('metalnessmap_fragment', 'texture2D( metalnessMap, vMetalnessMapUv )', 'ABYSSA_TEX( metalnessMap, vMetalnessMapUv )');
  rep('emissivemap_fragment', 'texture2D( emissiveMap, vEmissiveMapUv )', 'ABYSSA_TEX( emissiveMap, vEmissiveMapUv )');
})();

const HALTON_N = 16;
const HALTON = new Float32Array(HALTON_N * 2);
function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
for (let i = 0; i < HALTON_N; i++) { HALTON[i * 2] = halton(i + 1, 2) - 0.5; HALTON[i * 2 + 1] = halton(i + 1, 3) - 0.5; }

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

const RESOLVE_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tCur;
  uniform sampler2D tDepth;
  uniform sampler2D tHist;
  uniform sampler2D tVel;
  uniform float uVelOn;
  uniform vec4 uVelRect;
  uniform vec2 uIn;
  uniform vec2 uOut;
  uniform vec2 uJit;
  uniform mat4 uRe;
  uniform vec2 uNF;
  uniform float uReset;
  uniform vec4 uK;
  uniform vec2 uK2;
  uniform vec4 uSea;
  varying vec2 vUv;

  vec3 toYC(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
  vec3 fromYC(vec3 y) { return vec3(y.x + y.y - y.z, y.x + y.z, y.x - y.y - y.z); }
  float viewDist(float d) { return uNF.x * uNF.y / (uNF.y - d * (uNF.y - uNF.x)); }

  vec3 historyCR(vec2 uv) {
    vec2 sp = uv * uOut;
    vec2 tc = floor(sp - 0.5) + 0.5;
    vec2 f = sp - tc;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 o12 = w2 / w12;
    vec2 p0 = (tc - 1.0) / uOut, p3 = (tc + 2.0) / uOut, p12 = (tc + o12) / uOut;
    float a = w12.x * w0.y, b = w0.x * w12.y, c = w12.x * w12.y, d = w3.x * w12.y, e = w12.x * w3.y;
    vec3 r = texture2D(tHist, vec2(p12.x, p0.y)).rgb * a
           + texture2D(tHist, vec2(p0.x, p12.y)).rgb * b
           + texture2D(tHist, p12).rgb * c
           + texture2D(tHist, vec2(p3.x, p12.y)).rgb * d
           + texture2D(tHist, vec2(p12.x, p3.y)).rgb * e;
    return max(r / (a + b + c + d + e), vec3(0.0));
  }

  vec3 clipBox(vec3 bmin, vec3 bmax, vec3 q) {
    vec3 pc = 0.5 * (bmax + bmin);
    vec3 ec = 0.5 * (bmax - bmin) + 1e-5;
    vec3 v = q - pc;
    vec3 au = abs(v / ec);
    float m = max(au.x, max(au.y, au.z));
    return m > 1.0 ? pc + v / m : q;
  }

  void main() {
    vec2 pIn = vUv * uIn + uJit;
    ivec2 ic = ivec2(floor(pIn));
    ivec2 hi = ivec2(uIn) - 1;
    vec3 sum = vec3(0.0), sumW = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0);
    float wsumW = 0.0;
    vec3 bmn = vec3(1e5), bmx = vec3(-1e5);
    float wsum = 0.0, wmax = 0.0, dmin = 1.0;
    ivec2 tmin = ic;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        ivec2 t = clamp(ic + ivec2(x, y), ivec2(0), hi);
        vec3 c = texelFetch(tCur, t, 0).rgb;
        float d = texelFetch(tDepth, t, 0).r;
        if (d < dmin) { dmin = d; tmin = t; }
        vec2 o = vec2(t) + 0.5 - pIn;
        float w = exp(-2.29 * dot(o, o));
        vec3 yc = toYC(c);
        // Firefly taming: the spatial filter weights by 1/(1+luma), undone after.
        float wl = w / (1.0 + yc.x);
        sum += c * wl; wsum += wl; wmax = max(wmax, w);
        // A WIDE twin of the same kernel (sigma x1.6): what a pixel with no usable history
        // shows, so a disocclusion under upscaling reads soft for a frame, not blocky.
        float ww = exp(-0.9 * dot(o, o)) / (1.0 + yc.x);
        sumW += c * ww; wsumW += ww;
        m1 += yc; m2 += yc * yc;
        bmn = min(bmn, yc); bmx = max(bmx, yc);
      }
    }
    vec3 cur = sum / max(wsum, 1e-6);
    vec3 cy = toYC(cur);
    float z = viewDist(dmin);

    // Camera reprojection of the (dilated) surface.
    vec4 pc = uRe * vec4(vUv * 2.0 - 1.0, dmin * 2.0 - 1.0, 1.0);
    vec2 pUv = pc.xy / pc.w * 0.5 + 0.5;
    float pZ = pc.w * z;
    float seaFoam = 0.0;
    // A rigid mover under the (dilated) texel: its own motion replaces the camera's.
    if (uVelOn > 0.5 && tmin.x >= int(uVelRect.x) && tmin.y >= int(uVelRect.y) && tmin.x < int(uVelRect.z) && tmin.y < int(uVelRect.w)) {
      vec4 mv = texelFetch(tVel, tmin, 0);
      if (mv.b > 0.9 || (mv.b > 0.5 && uSea.w > 0.5)) { pUv = vUv - mv.xy; pZ = mv.a * z; }
      // the sea writes its vectors with its foam in the flag (0.55..0.85, see SEA_VEL_FRAG)
      seaFoam = mv.b > 0.5 && mv.b < 0.9 ? clamp((mv.b - 0.55) / 0.3, 0.0, 1.0) : 0.0;
    }
    float velPx = length((vUv - pUv) * uOut);

    float a = clamp(uK.x * wmax, uK.y, 1.0);
    a = max(a, uK2.x * clamp(velPx * uK2.y, 0.0, 1.0));
    // whitecap coverage this low already reads as white on screen (the lace texture), so
    // the mask saturates early
    a = max(a, uSea.z * smoothstep(0.02, 0.25, seaFoam));
    bool off = pUv.x < 0.0 || pUv.y < 0.0 || pUv.x > 1.0 || pUv.y > 1.0 || uReset > 0.5;
    vec3 outC = sumW / max(wsumW, 1e-6);
    if (!off) {
      // Disocclusion: the history alpha is the view distance it was resolved at.
      vec2 hp = pUv * uOut - 0.5;
      ivec2 h0 = ivec2(floor(hp));
      ivec2 hh = ivec2(uOut) - 1;
      float best = 1e9;
      for (int j = 0; j <= 1; j++) for (int i = 0; i <= 1; i++) {
        float hz = texelFetch(tHist, clamp(h0 + ivec2(i, j), ivec2(0), hh), 0).a;
        best = min(best, abs(hz - pZ) / max(pZ, 1e-3));
      }
      float occl = smoothstep(uK.w, uK.w * 3.0, best);
      vec3 hy = toYC(historyCR(pUv));
      vec3 mu = m1 * (1.0 / 9.0);
      vec3 sg = sqrt(max(m2 * (1.0 / 9.0) - mu * mu, vec3(0.0)));
      vec3 lo = max(bmn, mu - uK.z * sg), up = min(bmx, mu + uK.z * sg);
      lo = min(lo, cy); up = max(up, cy);
      vec3 hc = clipBox(lo, up, hy);
      // Anti-ghost: history that had to be clipped far (a fish that swam off, a sprite
      // that moved) is trusted less, in proportion to how far it was pulled, relative to
      // the neighbourhood's own spread.
      float pulled = length((hy - hc).x) / (0.02 + sg.x * 2.0 + 0.1 * mu.x);
      hy = hc;
      a = max(a, uK2.x * 2.0 * clamp(pulled - 0.5, 0.0, 1.0));
      cur = mix(cur, outC, occl);
      cy = toYC(cur);
      a = mix(a, 1.0, occl);
      float wc = a / (1.0 + cy.x), wh = (1.0 - a) / (1.0 + max(hy.x, 0.0));
      outC = fromYC((cy * wc + hy * wh) / max(wc + wh, 1e-6));
    }
    gl_FragColor = vec4(max(outC, vec3(0.0)), z);
  }`;

// Output finish at OUTPUT resolution, to the canvas: RCAS (FSR1's robust contrast-adaptive
// sharpen, lobe from saturated values so bloom highlights above 1 cannot invert it),
// then the vignette and the shadow grain the SMAA pass used to carry, then the sRGB
// encode three appends for a null target.
const OUT_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tSrc;
  uniform vec2 uOut;
  uniform float uSharp;
  uniform vec2 uVig;
  uniform float uGrain;
  uniform float uTime;
  varying vec2 vUv;
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 hh = ivec2(uOut) - 1;
    vec3 e = texelFetch(tSrc, p, 0).rgb;
    vec3 c = e;
    if (uSharp > 0.0) {
      vec3 b = texelFetch(tSrc, clamp(p + ivec2(0, 1), ivec2(0), hh), 0).rgb;
      vec3 d = texelFetch(tSrc, clamp(p - ivec2(1, 0), ivec2(0), hh), 0).rgb;
      vec3 f = texelFetch(tSrc, clamp(p + ivec2(1, 0), ivec2(0), hh), 0).rgb;
      vec3 h = texelFetch(tSrc, clamp(p - ivec2(0, 1), ivec2(0), hh), 0).rgb;
      vec3 sb = clamp(b, 0.0, 1.0), sd = clamp(d, 0.0, 1.0), sf = clamp(f, 0.0, 1.0), sh = clamp(h, 0.0, 1.0), se = clamp(e, 0.0, 1.0);
      vec3 mn4 = min(min(sb, sd), min(sf, sh));
      vec3 mx4 = max(max(sb, sd), max(sf, sh));
      vec3 hitMin = min(mn4, se) / (4.0 * mx4 + 1e-4);
      vec3 hitMax = (1.0 - max(mx4, se)) / (4.0 * min(mn4, se) - 4.0 - 1e-4);
      vec3 lobeC = max(-hitMin, hitMax);
      float lobe = max(-0.1875, min(max(lobeC.r, max(lobeC.g, lobeC.b)), 0.0)) * uSharp;
      c = max((lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0), vec3(0.0));
    }
    vec2 uv = gl_FragCoord.xy / uOut;
    float dv = distance(uv, vec2(0.5));
    c *= 1.0 - smoothstep(uVig.x * 0.799, 0.8, dv * (uVig.y + uVig.x));
    float g = fract(sin(dot(uv * uOut + fract(uTime * 0.6180339887) * 91.7, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    c += g * uGrain * (1.0 - smoothstep(0.0, 0.75, lum(c)));
    c += g * 0.0039215686;
    gl_FragColor = vec4(max(c, vec3(0.0)), 1.0);
    #include <colorspace_fragment>
  }`;

// OBJECT MOTION for RIGID movers (Sal's hard parts, the raft). Their meshes carry no vertex
// deformation (checked: diver.js patches only varyings), so a per-mesh previous
// modelMatrix gives exact motion vectors. Each mover mesh gets a PROXY in a private
// scene (shared geometry, own tiny ShaderMaterial clone, matrixWorld copied from the
// real mesh), so the velocity draw never touches the real scene graph, its lights or
// the shadow map. The proxies draw with the CURRENT (jittered) projection so they land on
// the same texels as the scene; a fragment behind the scene's own depth is discarded
// (occluded mover). Output: rg = uv motion (current - previous, unjittered), b = 1 flag,
// a = previous clip w / current clip w (the disocclusion test's expected depth ratio).
const VEL_VERT = /* glsl */`
  uniform mat4 uCurVP;
  uniform mat4 uPrevVP;
  uniform mat4 uPrevModel;
  varying vec4 vCur;
  varying vec4 vPrev;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vCur = uCurVP * wp;
    vPrev = uPrevVP * (uPrevModel * vec4(position, 1.0));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const VEL_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tDepth;
  uniform vec2 uIn;
  uniform vec2 uNF;
  uniform float uFlag;
  varying vec4 vCur;
  varying vec4 vPrev;
  float viewDist(float d) { return uNF.x * uNF.y / (uNF.y - d * (uNF.y - uNF.x)); }
  void main() {
    float sd = texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).r;
    float fz = viewDist(gl_FragCoord.z), sz = viewDist(sd);
    if (fz > sz * 1.01 + 0.02) discard;
    vec2 v = (vCur.xy / vCur.w - vPrev.xy / vPrev.w) * 0.5;
    gl_FragColor = vec4(v, uFlag, vPrev.w / max(vCur.w, 1e-4));
  }`;

// THE SEA (polish-leftovers-oct). The FFT surface is transparent and writes no depth, so
// TAA reprojected a sea pixel by the depth BEHIND it (the seabed, the far plane) and with
// no motion of its own: the gale's whitewater, which rides the water particles, was blended
// with history from where the swell had already carried it, and went soft. The sea now
// draws its own vectors into the velocity target: the same geomorphed clipmap the surface
// draws (one call), so every sea pixel is reprojected from where the SURFACE was, not the
// seabed behind it. uOrb (K.seaOrb, default 0) adds the water's own orbital motion from the
// PREVIOUS step's field (ocean.js keeps both halves of its merge ping-pong; uOcVelK = 0 when
// the sim held this frame): measured, it did not help -- the whitecaps' lace texture is
// anchored in WORLD space (water.js foamTex on vW), so the surface's camera motion is the
// right vector for it, and only the coverage rides the particles.
// Occlusion is VEL_FRAG's depth-copy test (the raft in front discards it); movers draw
// after it and win where they are visible. Its flag carries the foam (SEA_VEL_FRAG).
const SEA_VEL_VERT = /* glsl */`
  uniform mat4 uCurVP;
  uniform mat4 uPrevVP;
  uniform vec2 uOcLevC[ ${GRID_LEVELS} ];
  uniform vec3 uCam;
  uniform float uOcVelK;
  uniform float uOrb;
  ${OCEAN_GLSL_DISP}
  ${OCEAN_GLSL_DISP_PREV}
  varying vec4 vCur;
  varying vec4 vPrev;
  varying vec2 vG;
  varying vec2 vP0;
  flat varying vec3 vHole;
  void main() {
    int l = int(position.y + 0.5);
    float s = uOcGrid.x * exp2(float(l));
    vec2 c = uOcLevC[l];
    vec2 p = c + position.xz * s;
    vG = p;
    float R = uOcGrid.y * s;
    vHole = l > 0 ? vec3(uOcLevC[l - 1], 0.5 * R) : vec3(0.0, 0.0, -1.0);
    vec2 dc = abs(p - c);
    float m = clamp((max(dc.x, dc.y) / R - 0.70) / 0.22, 0.0, 1.0);
    p -= fract(p / (2.0 * s)) * (2.0 * s) * m;
    vP0 = p;
    vec3 D = ocDisp(p, uCam.xz);
    vec3 Dp = mix(D, ocDispPrev(p, uCam.xz), uOcVelK * uOrb);
    vec4 w = vec4(p.x + D.x, ${SURFACE_Y.toFixed(3)} + D.y, p.y + D.z, 1.0);
    vCur = uCurVP * w;
    vPrev = uPrevVP * vec4(p.x + Dp.x, ${SURFACE_Y.toFixed(3)} + Dp.y, p.y + Dp.z, 1.0);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
// THE REACTIVE MASK. History is the wrong answer for whitewater whatever the vectors say:
// it is born, torn and re-textured every frame. The fragment reads the same foam the sea
// shades with (the live fold of all three cascades' Jacobian + their persistent memory,
// water.js's foamJ less the gust break-up) and writes it into the flag: b = 0.55 + 0.3 foam.
// The resolve lifts the blend weight by K.seaA x foam, so the open sea keeps its full
// accumulation (its ripples and glints alias without it) and only the whitecaps go reactive.
const SEA_VEL_FRAG = VEL_FRAG.replace('void main() {', `varying vec2 vG;
  varying vec2 vP0;
  flat varying vec3 vHole;
  uniform vec3 uOcL;
  uniform vec4 uOcK;
  uniform sampler2D uOcFoam0, uOcFoam1, uOcFoam2;
  void main() {
    if (vHole.z > 0.0) { vec2 hd = abs(vG - vHole.xy); if (max(hd.x, hd.y) < vHole.z * 0.99999) discard; }`)
  .replace('gl_FragColor = vec4(v, uFlag,', `vec4 j0 = texture2D(uOcFoam0, vP0 / uOcL.x), j1 = texture2D(uOcFoam1, vP0 / uOcL.y), j2 = texture2D(uOcFoam2, vP0 / uOcL.z);
    float Jt = (1.0 + j0.x + j1.x + j2.x) * (1.0 + j0.y + j1.y + j2.y) - (j0.z + j1.z + j2.z) * (j0.z + j1.z + j2.z);
    float foam = max(1.0 - smoothstep(uOcK.x - uOcK.y, uOcK.x, Jt), max(max(j0.w, j1.w), j2.w * 0.45));
    gl_FragColor = vec4(v, 0.55 + 0.3 * clamp(foam, 0.0, 1.0),`);

// SKINNED movers (salreal: Sal's dress). The same proxy idea with the source's OWN skeleton:
// the current position is skinned with this frame's bone palette (three uploads it as
// boneTexture for the proxy, from the shared Skeleton), the previous one with LAST frame's
// palette, kept per skeleton in a twin float texture (copied after each velocity draw, like
// uPrevModel). In three's attached bind mode sum(w * bone * bindMatrix * p) is already the
// world position, so no model matrix is involved. Exact for linear-blend skinning; a
// material's own vertex tweaks on top of the skin (the dress's mm-scale corrective push)
// are not in it.
const VEL_SKIN_VERT = /* glsl */`
  uniform mat4 uCurVP;
  uniform mat4 uPrevVP;
  uniform highp sampler2D uPrevBones;
  varying vec4 vCur;
  varying vec4 vPrev;
  #include <skinning_pars_vertex>
  mat4 prevBone(const in float i) {
    int size = textureSize(uPrevBones, 0).x;
    int j = int(i) * 4;
    int x = j % size;
    int y = j / size;
    return mat4(texelFetch(uPrevBones, ivec2(x, y), 0), texelFetch(uPrevBones, ivec2(x + 1, y), 0),
      texelFetch(uPrevBones, ivec2(x + 2, y), 0), texelFetch(uPrevBones, ivec2(x + 3, y), 0));
  }
  void main() {
    #include <skinbase_vertex>
    vec4 sv = bindMatrix * vec4(position, 1.0);
    vec4 wp = (boneMatX * sv) * skinWeight.x + (boneMatY * sv) * skinWeight.y + (boneMatZ * sv) * skinWeight.z + (boneMatW * sv) * skinWeight.w;
    vec4 pp = (prevBone(skinIndex.x) * sv) * skinWeight.x + (prevBone(skinIndex.y) * sv) * skinWeight.y
      + (prevBone(skinIndex.z) * sv) * skinWeight.z + (prevBone(skinIndex.w) * sv) * skinWeight.w;
    wp /= wp.w; pp /= pp.w;
    vCur = uCurVP * wp;
    vPrev = uPrevVP * pp;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const _vp = new THREE.Matrix4(), _ivp = new THREE.Matrix4(), _prevVP = new THREE.Matrix4();
const _mv = new THREE.Vector3(), _mv2 = new THREE.Vector3(), _clr = new THREE.Color();
function worldVisible(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }
const _camPos = new THREE.Vector3(), _prevPos = new THREE.Vector3();
const _dir = new THREE.Vector3(), _prevDir = new THREE.Vector3();

export class TemporalAAPass extends Pass {
  constructor(camera) {
    super('TemporalAAPass');
    this.needsSwap = false;
    this.mainCam = camera;
    this.depthTexture = null;
    this.inW = 1; this.inH = 1; this.outW = 0; this.outH = 0;
    this.hist = [null, null]; this.cur = 0;
    this.frame = 0; this.valid = false; this.resets = 0; this.lastReset = '';
    this.jx = 0; this.jy = 0;
    // Knobs (window.__taa.K): alpha gain, alpha floor, clip gamma, disocclusion tolerance,
    // motion alpha cap + per-pixel gain, sharpen, cut distance (units per frame).
    // sea: 1 = the sea draws its own motion vectors + foam reactive mask (0 = the A/B);
    // seaA = the blend-weight floor on full whitewater (scaled by the foam mask); seaVec 0
    // keeps the mask but drops the vectors (with seaA 0 that is exactly the old resolve).
    this.K = { alpha: 0.12, alphaMin: 0.035, gamma: 1.1, occl: 0.035, motionA: 0.18, motionK: 1 / 24, sharp: 0.35, cut: 5, jitter: 1, velDepth: 0, mip: 1, skinVel: 1, sea: 1, seaVec: 1, seaA: 0.6, seaOrb: 0 };
    this.savedProj = new THREE.Matrix4(); this.savedProjInv = new THREE.Matrix4(); this.jittered = false;
    this.resolveMat = new THREE.ShaderMaterial({
      name: 'AbyssaTAAResolve', vertexShader: VERT, fragmentShader: RESOLVE_FRAG,
      depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        tCur: { value: null }, tDepth: { value: null }, tHist: { value: null },
        uIn: { value: new THREE.Vector2(1, 1) }, uOut: { value: new THREE.Vector2(1, 1) },
        uJit: { value: new THREE.Vector2() }, uRe: { value: new THREE.Matrix4() },
        uNF: { value: new THREE.Vector2(0.1, 700) }, uReset: { value: 1 },
        uK: { value: new THREE.Vector4() }, uK2: { value: new THREE.Vector2() },
        uSea: { value: new THREE.Vector4(0, 0, 0, 0) }
      }
    });
    this.outMat = new THREE.ShaderMaterial({
      name: 'AbyssaTAAOut', vertexShader: VERT, fragmentShader: OUT_FRAG,
      depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        tSrc: { value: null }, uOut: { value: new THREE.Vector2(1, 1) }, uSharp: { value: 0.25 },
        uVig: { value: new THREE.Vector2(0.28, 0.55) }, uGrain: { value: 0.026 }, uTime: { value: 0 }
      }
    });
    this.fullscreenMaterial = this.resolveMat;
    // Rigid movers (see VEL_VERT). velRT is colour-only by default (K.velDepth = 1 gives it
    // its OWN depth renderbuffer -- never a shared attachment); occlusion is the depth-copy
    // compare in VEL_FRAG either way.
    this.movers = []; this.proxies = []; this.proxyOf = new Map(); this.moverScan = 0;
    this.velScene = new THREE.Scene(); this.velScene.matrixWorldAutoUpdate = false;
    this.velRT = null; this.velOn = true; this.velDrawn = 0;
    this.velBase = new THREE.ShaderMaterial({
      name: 'AbyssaTAAVelocity', vertexShader: VEL_VERT, fragmentShader: VEL_FRAG, toneMapped: false,
      uniforms: { uCurVP: { value: null }, uPrevVP: { value: null }, uPrevModel: { value: null },
        tDepth: { value: null }, uIn: { value: null }, uNF: { value: null }, uFlag: { value: 1 } }
    });
    this.curVP = new THREE.Matrix4(); this.prevVP = new THREE.Matrix4();
    this.velIn = new THREE.Vector2(1, 1);
    this.velRect = new THREE.Vector4();
    this.resolveMat.uniforms.tVel = { value: null };
    this.resolveMat.uniforms.uVelOn = { value: 0 };
    this.resolveMat.uniforms.uVelRect = { value: this.velRect };
    this.velSkinBase = new THREE.ShaderMaterial({
      name: 'AbyssaTAAVelocitySkin', vertexShader: VEL_SKIN_VERT, fragmentShader: VEL_FRAG, toneMapped: false,
      uniforms: { uCurVP: { value: null }, uPrevVP: { value: null }, uPrevBones: { value: null },
        tDepth: { value: null }, uIn: { value: null }, uNF: { value: null }, uFlag: { value: 1 } }
    });
    this.prevPal = new Map();      // Skeleton -> { arr, tex, sk } last frame's bone palette
    this.palList = [];             // the same, iterated per frame without an iterator object
    this._scanFn = (o) => {
      if (o.isSkinnedMesh && o.skeleton && o.geometry && !this.proxyOf.has(o)) { this._addSkinned(o); return; }
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.geometry || this.proxyOf.has(o)) return;
      const m = this.velBase.clone();
      const u = m.uniforms;
      u.uCurVP.value = this.curVP; u.uPrevVP.value = this.prevVP; u.uPrevModel.value = new THREE.Matrix4().copy(o.matrixWorld);
      u.uIn.value = this.velIn; u.uNF.value = this.resolveMat.uniforms.uNF.value;
      m.side = o.material && o.material.side !== undefined ? o.material.side : THREE.FrontSide;
      const px = new THREE.Mesh(o.geometry, m);
      px.matrixAutoUpdate = false; px.matrixWorldAutoUpdate = false; px.frustumCulled = o.frustumCulled;
      px.userData.src = o; px.userData.fresh = true;
      this.velScene.add(px); this.proxies.push(px); this.proxyOf.set(o, px);
    };
  }

  _palette(sk) {
    let p = this.prevPal.get(sk);
    if (!p) {
      if (sk.boneTexture === null) sk.computeBoneTexture();
      const img = sk.boneTexture.image, arr = new Float32Array(img.data.length);
      arr.set(sk.boneMatrices);
      const tex = new THREE.DataTexture(arr, img.width, img.height, THREE.RGBAFormat, THREE.FloatType);
      tex.needsUpdate = true;
      p = { arr, tex, fresh: true, sk };
      this.prevPal.set(sk, p); this.palList.push(p);
    }
    return p;
  }
  _addSkinned(o) {
    const m = this.velSkinBase.clone(), u = m.uniforms;
    u.uCurVP.value = this.curVP; u.uPrevVP.value = this.prevVP;
    u.uIn.value = this.velIn; u.uNF.value = this.resolveMat.uniforms.uNF.value;
    u.uPrevBones.value = this._palette(o.skeleton).tex;
    m.side = o.material && o.material.side !== undefined ? o.material.side : THREE.FrontSide;
    const px = new THREE.SkinnedMesh(o.geometry, m);
    px.bind(o.skeleton, o.bindMatrix);
    px.matrixAutoUpdate = false; px.matrixWorldAutoUpdate = false; px.frustumCulled = o.frustumCulled;
    px.userData.src = o; px.userData.fresh = true; px.userData.skin = true;
    this.velScene.add(px); this.proxies.push(px); this.proxyOf.set(o, px);
  }

  // Register a rigid mover's root (whole hierarchy). Meshes added under it later are
  // picked up by a rescan every 30 frames; removed ones are dropped the same way.
  addMover(root) { if (root && this.movers.indexOf(root) < 0) { this.movers.push(root); root.traverse(this._scanFn); } }
  _rescan() {
    for (let i = 0; i < this.movers.length; i++) this.movers[i].traverse(this._scanFn);
    for (let i = this.proxies.length - 1; i >= 0; i--) {
      const px = this.proxies[i], src = px.userData.src;
      let o = src; while (o && this.movers.indexOf(o) < 0) o = o.parent;
      if (!o) { this.velScene.remove(px); px.material.dispose(); this.proxies.splice(i, 1); this.proxyOf.delete(src); if (px.userData.skin && ![...this.proxyOf.keys()].some(k => k.skeleton === src.skeleton)) { const p = this.prevPal.get(src.skeleton); if (p) { p.tex.dispose(); this.palList.splice(this.palList.indexOf(p), 1); } this.prevPal.delete(src.skeleton); } }
    }
  }
  _renderVelocity(renderer) {
    if (!this.velOn || !this.proxies.length && !this.movers.length && !this.K.sea) return false;
    if ((this.moverScan++ % 30) === 0) this._rescan();
    const wantDepth = !!this.K.velDepth;
    if (!this.velRT || this.velRT.width !== this.inW || this.velRT.height !== this.inH || this.velRT.depthBuffer !== wantDepth) {
      if (this.velRT) this.velRT.dispose();
      this.velRT = new THREE.WebGLRenderTarget(this.inW, this.inH, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter, depthBuffer: wantDepth, stencilBuffer: false, generateMipmaps: false
      });
      this.velRT.texture.name = 'TAA.Velocity';
    }
    this.velIn.set(this.inW, this.inH);
    const cam = this.mainCam;
    cam.getWorldPosition(_mv);
    let n = 0;
    // the sea first (renderOrder -1: painted under every mover), full screen when the eye is
    // above the water
    if (!this.seaPx && oceanReady()) {
      const m = new THREE.ShaderMaterial({
        name: 'AbyssaTAASeaVelocity', vertexShader: SEA_VEL_VERT, fragmentShader: SEA_VEL_FRAG, toneMapped: false,
        side: THREE.DoubleSide,
        uniforms: { ...OCEAN_UNIFORMS, uOcDispP0: uOcDispPrev[0], uOcDispP1: uOcDispPrev[1], uOcDispP2: uOcDispPrev[2], uOcVelK, uOrb: { value: 0 },
          uCurVP: { value: this.curVP }, uPrevVP: { value: this.prevVP }, uCam: { value: new THREE.Vector3() },
          tDepth: { value: null }, uIn: { value: this.velIn }, uNF: { value: this.resolveMat.uniforms.uNF.value }, uFlag: { value: 0.75 } }
      });
      this.seaPx = new THREE.Mesh(buildOceanGeometry(), m);
      this.seaPx.frustumCulled = false; this.seaPx.renderOrder = -1;
      this.seaPx.matrixAutoUpdate = false; this.seaPx.matrixWorldAutoUpdate = false;
      this.velScene.add(this.seaPx);
    }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    if (this.seaPx) {
      const on = !!this.K.sea && _mv.y > SURFACE_Y + 0.3 && this.valid;
      this.seaPx.visible = on;
      if (on) {
        const su = this.seaPx.material.uniforms;
        su.uCam.value.copy(_mv); su.tDepth.value = this.depthTexture; su.uOrb.value = this.K.seaOrb;
        x0 = 0; y0 = 0; x1 = 1; y1 = 1; n++;
      }
    }
    // Screen rect of every visible mover (bounding spheres, projected): the clear and the
    // draw are SCISSORED to it and the resolve ignores velocity outside it, so the pass
    // costs Sal's footprint, not a full-screen target clear (the sea, when drawn, is all of it).
    const pe = this.savedProj.elements, ve = cam.matrixWorldInverse.elements;
    for (let i = 0; i < this.proxies.length; i++) {
      const px = this.proxies[i], src = px.userData.src;
      const vis = worldVisible(src) && src.matrixWorld.elements[12] !== undefined
        && Math.hypot(src.matrixWorld.elements[12] - _mv.x, src.matrixWorld.elements[13] - _mv.y, src.matrixWorld.elements[14] - _mv.z) < 160;
      px.visible = vis;
      px.matrixWorld.copy(src.matrixWorld);
      const u = px.material.uniforms;
      u.tDepth.value = this.depthTexture;
      if (px.userData.skin) {
        // no history yet: last frame's palette = this frame's (zero motion, not garbage)
        const pal = this._palette(src.skeleton);
        if (px.userData.fresh || !this.valid || pal.fresh) { pal.arr.set(src.skeleton.boneMatrices); pal.tex.needsUpdate = true; pal.fresh = false; px.userData.fresh = false; }
        // K.skinVel 0 (A/B): the skin's vectors are written with flag 0.25, which the resolve
        // ignores (b > 0.5) — exactly the pass before skinned movers existed — while a debug
        // readback still sees the silhouette
        u.uFlag.value = this.K.skinVel === 0 ? 0.25 : 1;
      } else if (px.userData.fresh || !this.valid) { u.uPrevModel.value.copy(src.matrixWorld); px.userData.fresh = false; }
      if (!vis) continue;
      n++;
      const bs = src.geometry.boundingSphere || (src.geometry.computeBoundingSphere(), src.geometry.boundingSphere);
      _mv2.copy(bs.center).applyMatrix4(src.matrixWorld);
      const me = src.matrixWorld.elements;
      const sc = Math.sqrt(Math.max(me[0] * me[0] + me[1] * me[1] + me[2] * me[2], me[4] * me[4] + me[5] * me[5] + me[6] * me[6], me[8] * me[8] + me[9] * me[9] + me[10] * me[10]));
      const r = bs.radius * sc;
      const vx = ve[0] * _mv2.x + ve[4] * _mv2.y + ve[8] * _mv2.z + ve[12];
      const vy = ve[1] * _mv2.x + ve[5] * _mv2.y + ve[9] * _mv2.z + ve[13];
      const vz = ve[2] * _mv2.x + ve[6] * _mv2.y + ve[10] * _mv2.z + ve[14];
      const w = -vz;
      if (w - r < 0.05) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; continue; }   // camera inside or near: full screen
      const cx = (pe[0] * vx + pe[8] * vz) / w, cy = (pe[5] * vy + pe[9] * vz) / w;
      const rx = pe[0] * r / (w - r), ry = pe[5] * r / (w - r);
      x0 = Math.min(x0, (cx - rx) * 0.5 + 0.5); x1 = Math.max(x1, (cx + rx) * 0.5 + 0.5);
      y0 = Math.min(y0, (cy - ry) * 0.5 + 0.5); y1 = Math.max(y1, (cy + ry) * 0.5 + 0.5);
    }
    this.velDrawn = n;
    if (!n) return false;
    const W = this.inW, H = this.inH;
    const rx0 = Math.max(0, Math.floor(x0 * W) - 4), ry0 = Math.max(0, Math.floor(y0 * H) - 4);
    const rx1 = Math.min(W, Math.ceil(x1 * W) + 4), ry1 = Math.min(H, Math.ceil(y1 * H) + 4);
    if (rx1 <= rx0 || ry1 <= ry0) return false;
    this.velRect.set(rx0, ry0, rx1, ry1);
    const sm = renderer.shadowMap.autoUpdate, cc = renderer.getClearColor(_clr), ca = renderer.getClearAlpha();
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.velRT);
    this.velRT.scissor.set(rx0, ry0, rx1 - rx0, ry1 - ry0);
    this.velRT.scissorTest = true;
    renderer.setRenderTarget(this.velRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, wantDepth, false);
    renderer.render(this.velScene, cam);
    this.velRT.scissorTest = false;
    renderer.setClearColor(cc, ca);
    renderer.shadowMap.autoUpdate = sm;
    for (let i = 0; i < this.proxies.length; i++) {
      const px = this.proxies[i];
      if (!px.userData.skin) px.material.uniforms.uPrevModel.value.copy(px.userData.src.matrixWorld);
    }
    // last frame's bone palettes for the skinned movers (per skeleton, not per mesh)
    for (let i = 0; i < this.palList.length; i++) { const pal = this.palList[i]; pal.arr.set(pal.sk.boneMatrices); pal.tex.needsUpdate = true; }
    return true;
  }

  setDepthTexture(t) { if (t && t !== this.depthTexture && t.isTexture && t.name === 'DepthCopyPass.Target') this.depthTexture = t; }
  useDepth(t) { this.depthTexture = t; }
  setSize(w, h) { this.inW = w; this.inH = h; }
  setOutputSize(w, h) {
    if (w === this.outW && h === this.outH && this.hist[0]) return false;
    this.outW = w; this.outH = h;
    for (let i = 0; i < 2; i++) {
      if (!this.hist[i]) {
        this.hist[i] = new THREE.WebGLRenderTarget(w, h, {
          type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false
        });
        this.hist[i].texture.name = 'TAA.History' + i;
      } else this.hist[i].setSize(w, h);
    }
    this.reset('output-resize');
    return true;
  }
  reset(why) { this.valid = false; this.resets++; this.lastReset = why || ''; }

  // Called by postfx.js BEFORE composer.render: records the unjittered view-projection,
  // detects camera cuts, and jitters the projection for the whole chain.
  begin(camera) {
    camera.updateMatrixWorld();
    _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    camera.getWorldPosition(_camPos);
    camera.getWorldDirection(_dir);
    if (this.valid && (_camPos.distanceTo(_prevPos) > this.K.cut || _dir.dot(_prevDir) < 0.7)) this.reset('camera-cut');
    const u = this.resolveMat.uniforms;
    if (this.valid) u.uRe.value.multiplyMatrices(_prevVP, _ivp.copy(_vp).invert());
    else u.uRe.value.identity();
    u.uReset.value = this.valid ? 0 : 1;
    this.prevVP.copy(this.valid ? _prevVP : _vp); this.curVP.copy(_vp);
    u.uSea.value.set(0, 0, this.K.seaA, this.K.seaVec ? 1 : 0);
    _prevVP.copy(_vp); _prevPos.copy(_camPos); _prevDir.copy(_dir);
    const k = (this.frame++) % HALTON_N;
    this.jx = HALTON[k * 2] * this.K.jitter; this.jy = HALTON[k * 2 + 1] * this.K.jitter;
    const pm = camera.projectionMatrix, e = pm.elements;
    this.savedProj.copy(pm); this.savedProjInv.copy(camera.projectionMatrixInverse);
    // NDC shift of +2J/size moves the image content by +J internal pixels (see resolve).
    e[8] -= this.jx * 2 / this.inW;
    e[9] -= this.jy * 2 / this.inH;
    camera.projectionMatrixInverse.copy(pm).invert();
    this.jittered = true;
    u.uJit.value.set(this.jx, this.jy);
    u.uNF.value.set(camera.near, camera.far);
  }
  // Called AFTER composer.render (and from a throw path): removes the jitter.
  end(camera) {
    if (!this.jittered) return;
    camera.projectionMatrix.copy(this.savedProj);
    camera.projectionMatrixInverse.copy(this.savedProjInv);
    this.jittered = false;
  }

  render(renderer, inputBuffer) {
    if (!this.hist[0]) return;
    const K = this.K, u = this.resolveMat.uniforms;
    this.lastIn = inputBuffer;            // debug readback (__taa.pass().lastIn): the frame's input, for ghost metrics
    const velLive = this._renderVelocity(renderer);
    u.uVelOn.value = velLive ? 1 : 0;
    u.tVel.value = velLive ? this.velRT.texture : null;
    const src = this.hist[this.cur], dst = this.hist[1 - this.cur];
    u.tCur.value = inputBuffer.texture;
    u.tDepth.value = this.depthTexture;
    u.tHist.value = src.texture;
    u.uIn.value.set(this.inW, this.inH);
    u.uOut.value.set(this.outW, this.outH);
    u.uK.value.set(K.alpha, K.alphaMin, K.gamma, K.occl);
    u.uK2.value.set(K.motionA, K.motionK);
    this.fullscreenMaterial = this.resolveMat;
    renderer.setRenderTarget(dst);
    renderer.render(this.scene, this.camera);
    this.valid = true;
    this.cur = 1 - this.cur;
    // Output finish, to the canvas at OUTPUT size (the renderer's own size is internal).
    const o = this.outMat.uniforms;
    o.tSrc.value = dst.texture;
    o.uOut.value.set(this.outW, this.outH);
    // Upscaling softens: sharpen scales with the ratio (FSR's guidance, gently).
    const ratio = this.outW / Math.max(1, this.inW);
    o.uSharp.value = Math.min(1, K.sharp * (0.6 + 0.4 * ratio * ratio));
    this.fullscreenMaterial = this.outMat;
    // postfx.js's frame-latency probe syncs HERE, before the one draw that touches the
    // canvas: a sync after it also waits on the compositor's next free drawable (vsync).
    if (this.beforeOutput) this.beforeOutput();
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, this.outW, this.outH);
    renderer.render(this.scene, this.camera);
    renderer.setViewport(0, 0, this.inW, this.inH);
    this.fullscreenMaterial = this.resolveMat;
  }

  dispose() {
    for (const h of this.hist) if (h) h.dispose();
    if (this.velRT) this.velRT.dispose();
    if (this.seaPx) { this.seaPx.geometry.dispose(); this.seaPx.material.dispose(); }
    for (const px of this.proxies) px.material.dispose();
    for (const p of this.prevPal.values()) p.tex.dispose();
    this.resolveMat.dispose(); this.outMat.dispose();
  }
}
