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
  uniform vec2 uIn;
  uniform vec2 uOut;
  uniform vec2 uJit;
  uniform mat4 uRe;
  uniform vec2 uNF;
  uniform float uReset;
  uniform vec4 uK;
  uniform vec2 uK2;
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
    vec3 sum = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0);
    vec3 bmn = vec3(1e5), bmx = vec3(-1e5);
    float wsum = 0.0, wmax = 0.0, dmin = 1.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        ivec2 t = clamp(ic + ivec2(x, y), ivec2(0), hi);
        vec3 c = texelFetch(tCur, t, 0).rgb;
        float d = texelFetch(tDepth, t, 0).r;
        dmin = min(dmin, d);
        vec2 o = vec2(t) + 0.5 - pIn;
        float w = exp(-2.29 * dot(o, o));
        vec3 yc = toYC(c);
        // Firefly taming: the spatial filter weights by 1/(1+luma), undone after.
        float wl = w / (1.0 + yc.x);
        sum += c * wl; wsum += wl; wmax = max(wmax, w);
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
    float velPx = length((vUv - pUv) * uOut);

    float a = clamp(uK.x * wmax, uK.y, 1.0);
    a = max(a, uK2.x * clamp(velPx * uK2.y, 0.0, 1.0));
    bool off = pUv.x < 0.0 || pUv.y < 0.0 || pUv.x > 1.0 || pUv.y > 1.0 || uReset > 0.5;
    vec3 outC = cur;
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
      hy = clipBox(lo, up, hy);
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

const _vp = new THREE.Matrix4(), _ivp = new THREE.Matrix4(), _prevVP = new THREE.Matrix4();
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
    this.K = { alpha: 0.12, alphaMin: 0.035, gamma: 1.1, occl: 0.035, motionA: 0.18, motionK: 1 / 24, sharp: 0.25, cut: 5, jitter: 1 };
    this.savedProj = new THREE.Matrix4(); this.savedProjInv = new THREE.Matrix4(); this.jittered = false;
    this.resolveMat = new THREE.ShaderMaterial({
      name: 'AbyssaTAAResolve', vertexShader: VERT, fragmentShader: RESOLVE_FRAG,
      depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        tCur: { value: null }, tDepth: { value: null }, tHist: { value: null },
        uIn: { value: new THREE.Vector2(1, 1) }, uOut: { value: new THREE.Vector2(1, 1) },
        uJit: { value: new THREE.Vector2() }, uRe: { value: new THREE.Matrix4() },
        uNF: { value: new THREE.Vector2(0.1, 700) }, uReset: { value: 1 },
        uK: { value: new THREE.Vector4() }, uK2: { value: new THREE.Vector2() }
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
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, this.outW, this.outH);
    renderer.render(this.scene, this.camera);
    renderer.setViewport(0, 0, this.inW, this.inH);
    this.fullscreenMaterial = this.resolveMat;
  }

  dispose() {
    for (const h of this.hist) if (h) h.dispose();
    this.resolveMat.dispose(); this.outMat.dispose();
  }
}
