// AUTO-EXPOSURE (roadmap/ref-auto-exposure.md). The eye, not the camera: the frame's
// mean log-luminance is metered on the GPU, adapts on the CPU with ASYMMETRIC time
// constants (fast toward a brighter scene, slow toward a darker one) and drives
// renderer.toneMappingExposure inside a HARD CLAMP that is a function of the same
// depth signal lighting.js blends its STOPS on — so the deep is never brightened past
// its authored look, and a furnace or a hoard of lanterns lifting the frame is answered
// by the exposure coming DOWN, which is the behaviour an eye has.
//
// Shape (the roadmap's "tiny RT, not a Pass" — this is a Pass SHELL around three tiny
// render targets, so the composer schedules it; nothing of the library's adaptive-
// luminance machinery is used and no history texture is shared):
//   inputBuffer (the composer's HalfFloat scene colour, tone-mapped at scene render)
//     -> 64x64  weighted log2 luminance, 8x8 sparse taps per cell   (RG: sum wl, sum w)
//     -> 8x8    exact box of the 64x64                               (same program)
//     -> 1x1    exact box of the 8x8, RGBA32F                        (same program)
//     -> PBO ring readback with fences: never a readPixels stall. A result lands 2-3
//        frames later and the CPU integrates it. ONE program, no depth attachments
//        (depthBuffer: false on all three — nothing to share, nothing to feedback).
//
// The buffer is TONE-MAPPED (three bakes ACES + exposure into every material at scene
// render), so the meter INVERTS the ACES fit per tap (the RRT+ODT rational, solved as a
// quadratic on luminance) and divides the renderer's exposure back out — the exposure
// of the frame being metered is exactly the one in force when the pass runs. What lands
// in the 1x1 is scene-referred log2 luminance, independent of the exposure: the loop
// has unit gain and an ABSOLUTE target (metered post-ACES the gain was ~0.1 on the
// deck and the exposure walked to the fence instead of settling — measured). The
// per-stop KEY is the authored scene-referred mean log2 luminance of that stop — the
// authored look is the set point, the clamp is the fence around it.
// THE SKY IS RAW: the dome and the sea surface are ShaderMaterials without the tone-map
// chunk, so their pixels are neither ACES'd nor exposed — inverting them anyway made
// the deck a positive-feedback loop (a lower exposure inflated the sky's reading by
// 1/exposure and the meter walked to the fence; measured -2.72 -> -2.21 over half a
// stop). Both leave depth at the far plane (depthWrite: false), so a tap at depth 1.0
// is taken as it is. The sea over the seabed still inverts (the bed behind it wrote
// depth) — a known residual, small next to the dome.
//
// Zero per-frame allocation except one WebGLSync per issued readback (a fence is a GL
// object, not JS heap; issued every `every` frames, default 2).
import * as THREE from 'three';
import { Pass } from 'postprocessing';
import { GLASS } from './config.js';
import { rig } from './lighting.js';

const VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4( position.xy, 1.0, 1.0 ); }`;

// One program for all three stages. TAPS x TAPS points inside this texel's cell of the
// source. uFirst: log2-luminance of the colour buffer with the centre weight; else an
// exact box over an RG (sum wl, sum w) stage. Averages, not sums, so half floats never
// approach their range: every stage's RG stays in [-14, 6].
const TAPS = 8;
const FRAG = `
precision highp float;
uniform sampler2D tSrc, tDepth;
uniform float uCells, uFirst, uCentre, uExp;
varying vec2 vUv;
// Inverse of three's RRTAndODTFit on a luminance: y = (v v + 0.0245786 v - 0.000090537)
// / (0.983729 v v + 0.4329510 v + 0.238081), the one positive root. y is capped short of
// 1.0 (a clipped white reads as ~20, not infinity). Scene value = v * 0.6 / exposure.
float acesInv( float y ) {
  y = min( y, 0.995 );
  float a = 1.0 - 0.983729 * y, b = 0.0245786 - 0.432951 * y, c = -0.000090537 - 0.238081 * y;
  return ( -b + sqrt( max( b * b - 4.0 * a * c, 0.0 ) ) ) / ( 2.0 * a );
}
void main(){
  vec2 cell = floor( vUv * uCells );
  vec2 acc = vec2( 0.0 );
  for ( int j = 0; j < ${TAPS}; j++ ) for ( int i = 0; i < ${TAPS}; i++ ) {
    vec2 o = ( vec2( float( i ), float( j ) ) + 0.5 ) / ${TAPS}.0;
    vec2 uv = ( cell + o ) / uCells;
    vec4 s = texture2D( tSrc, uv );
    if ( uFirst > 0.5 ) {
      float l = dot( max( s.rgb, 0.0 ), vec3( 0.2126, 0.7152, 0.0722 ) );
      float r = length( ( uv - 0.5 ) * 2.0 );
      // centre weight: 1 at the middle, 1 - uCentre at the far corner (r = 1.41)
      float w = 1.0 - uCentre * smoothstep( 0.30, 1.30, r );
      float raw = step( 0.99999, texture2D( tDepth, uv ).x );   // far plane: sky, unexposed
      float ls = mix( acesInv( l ) * 0.6 / uExp, l, raw );
      acc += vec2( log2( max( ls, 0.00001 ) ) * w, w );
    } else acc += s.rg;
  }
  gl_FragColor = vec4( acc / ${TAPS * TAPS}.0, 0.0, 1.0 );
}`;

function fullscreenTri() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  return g;
}

const PBO_RING = 3;
const log2 = Math.log2;

export class ExposurePass extends Pass {
  constructor(base) {
    super('AutoExposure');
    this.needsSwap = false;
    this.needsDepthTexture = true;
    this.base = base;                 // the authored constant exposure (1.32)
    const opt = {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping
    };
    this.rtA = new THREE.WebGLRenderTarget(64, 64, { ...opt, type: THREE.HalfFloatType });
    this.rtB = new THREE.WebGLRenderTarget(8, 8, { ...opt, type: THREE.HalfFloatType });
    this.rtC = new THREE.WebGLRenderTarget(1, 1, { ...opt, type: THREE.FloatType });
    this.rtA.texture.name = 'Exposure.64'; this.rtB.texture.name = 'Exposure.8'; this.rtC.texture.name = 'Exposure.1';
    this.material = new THREE.ShaderMaterial({
      name: 'AutoExposureMeter',
      uniforms: { tSrc: { value: null }, tDepth: { value: null }, uCells: { value: 64 }, uFirst: { value: 1 }, uCentre: { value: 0.6 }, uExp: { value: 1 } },
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, toneMapped: false
    });
    this.scene = new THREE.Scene();
    const m = new THREE.Mesh(fullscreenTri(), this.material); m.frustumCulled = false;
    this.scene.add(m);
    this.u = this.material.uniforms;

    // Readback ring: PBOs + fences, created lazily on the live context.
    this.gl = null; this.pbo = null; this.sync = new Array(PBO_RING).fill(null); this.head = 0; this.tail = 0;
    this.out = new Float32Array(4);
    this.frame = 0; this.failed = false;

    // Adaptation state. ev = log2 of the multiplier on `base`; lum = last metered mean.
    this.ev = 0; this.lum = 0; this.meanLog = -20; this.samples = 0; this.age = 0;
    this.lo = 1; this.hi = 1; this.key = 0; this.target = 0;
    this.stale = 0;
  }
  setSize() { /* fixed-size targets: the meter is resolution-independent by design */ }
  setDepthTexture(tex) { this.u.tDepth.value = tex; }
  initialize() { /* nothing to build against the framebuffer type */ }

  _glSetup(renderer) {
    const gl = renderer.getContext();
    if (!gl.fenceSync || !gl.PIXEL_PACK_BUFFER) { this.failed = true; return false; }
    this.gl = gl;
    this.pbo = [];
    for (let i = 0; i < PBO_RING; i++) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, 16, gl.STREAM_READ);
      this.pbo.push(b);
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return true;
  }
  // Drain finished readbacks in issue order; stop at the first still in flight.
  _poll() {
    const gl = this.gl;
    while (this.sync[this.head]) {
      const s = this.sync[this.head];
      const st = gl.clientWaitSync(s, 0, 0);
      if (st === gl.TIMEOUT_EXPIRED) break;
      gl.deleteSync(s); this.sync[this.head] = null;
      if (st !== gl.WAIT_FAILED) {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo[this.head]);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.out);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        const w = this.out[1];
        if (w > 1e-6 && isFinite(this.out[0])) { this.meanLog = this.out[0] / w; this.lum = Math.pow(2, this.meanLog); this.samples++; this.age = 0; }
      }
      this.head = (this.head + 1) % PBO_RING;
    }
  }

  render(renderer, inputBuffer) {
    const E = GLASS.exposure;
    if (!E || !(E.on > 0) || this.failed) return;
    if (!this.gl && !this._glSetup(renderer)) return;
    const gl = this.gl;
    this._poll();
    // Sparse in time as well as space: meter every `every` frames, and never with the
    // ring full (a slow readback simply drops this frame's sample).
    if ((this.frame++ % Math.max(1, E.every | 0)) !== 0 || this.sync[this.tail]) return;
    const u = this.u;
    u.uCentre.value = Math.max(0, Math.min(1, E.centre));
    u.uExp.value = Math.max(1e-3, renderer.toneMappingExposure);   // this frame's, exactly
    u.tSrc.value = inputBuffer.texture; u.uCells.value = 64; u.uFirst.value = 1;
    renderer.setRenderTarget(this.rtA); renderer.render(this.scene, this.camera);
    u.tSrc.value = this.rtA.texture; u.uCells.value = 8; u.uFirst.value = 0;
    renderer.setRenderTarget(this.rtB); renderer.render(this.scene, this.camera);
    u.tSrc.value = this.rtB.texture; u.uCells.value = 1;
    renderer.setRenderTarget(this.rtC); renderer.render(this.scene, this.camera);
    // The 1x1 is bound now: queue the read into the PBO and fence it.
    try {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo[this.tail]);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.sync[this.tail] = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      this.tail = (this.tail + 1) % PBO_RING;
    } catch (e) {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.failed = true;
      console.warn('ABYSSA: auto-exposure readback unavailable, exposure held at the authored constant', e);
    }
  }

  // The stop table, blended on lighting's depth01 (the STOPS signal). Flat keys so the
  // lab's knobGroup can drive them. Returns nothing; writes lo/hi/key.
  _stops(E) {
    const d = rig.depth01;
    const D = [E.d0, E.d1, E.d2, E.d3];
    let i = 0;
    while (i < 2 && d > D[i + 1]) i++;
    const t = Math.max(0, Math.min(1, (d - D[i]) / Math.max(1e-6, D[i + 1] - D[i])));
    const j = i + 1;
    this.lo = E['lo' + i] + (E['lo' + j] - E['lo' + i]) * t;
    this.hi = E['hi' + i] + (E['hi' + j] - E['hi' + i]) * t;
    this.key = E['key' + i] + (E['key' + j] - E['key' + i]) * t;
  }

  // CPU side, once per frame BEFORE the scene renders (the exposure it sets is the one
  // this frame's materials bake). dt in seconds. Returns the multiplier on `base`.
  update(dt, renderer) {
    const E = GLASS.exposure;
    if (!E || !(E.on > 0) || this.failed) { this.ev = 0; renderer.toneMappingExposure = this.base; return 1; }
    this._stops(E);
    const loE = log2(Math.max(1e-3, this.lo)), hiE = log2(Math.max(this.lo, this.hi));
    if (this.samples > 0) {
      // Absolute: the metered mean is scene-referred, so the EV that puts it on the key
      // does not depend on the exposure the sample was taken under.
      let want = (this.key - this.meanLog) + E.ev;
      want = Math.max(loE, Math.min(hiE, want));
      this.target = want;
      // Asymmetric: the scene got brighter (exposure must FALL) -> fast; darker -> slow.
      const tau = want < this.ev ? Math.max(0.05, E.tauBright) : Math.max(0.05, E.tauDark);
      this.ev += (want - this.ev) * (1 - Math.exp(-dt / tau));
      this.age += dt;
    }
    // The clamp is hard even mid-adaptation (a descent tightens the fence around a
    // still-adapting eye).
    this.ev = Math.max(loE, Math.min(hiE, this.ev));
    const mult = Math.pow(2, this.ev);
    renderer.toneMappingExposure = this.base * mult;
    return mult;
  }
  // P bypass / feature off: snap to the authored constant at once.
  reset(renderer) { this.ev = 0; this.target = 0; renderer.toneMappingExposure = this.base; }

  state() {
    return {
      lum: +this.lum.toFixed(5), meanLog: +this.meanLog.toFixed(3), ev: +this.ev.toFixed(4), target: +this.target.toFixed(4),
      mult: +Math.pow(2, this.ev).toFixed(4), exposure: +(this.base * Math.pow(2, this.ev)).toFixed(4),
      clamp: [+this.lo.toFixed(3), +this.hi.toFixed(3)], key: +this.key.toFixed(3), depth01: +rig.depth01.toFixed(3),
      samples: this.samples, age: +this.age.toFixed(2), failed: this.failed
    };
  }
  dispose() {
    this.rtA.dispose(); this.rtB.dispose(); this.rtC.dispose(); this.material.dispose();
    if (this.gl && this.pbo) { for (const b of this.pbo) this.gl.deleteBuffer(b); for (const s of this.sync) if (s) this.gl.deleteSync(s); }
    this.pbo = null;
  }
}
