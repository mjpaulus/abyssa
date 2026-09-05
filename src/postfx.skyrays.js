// CREPUSCULAR RAYS — the sky pokes through. OWNED BY: rays agent (roadmap/crepuscular-sky.md).
//
// Michael's photo: a dark layered cloud deck, a bright hole behind it, a fan of pale
// rays spreading down and outward from the hidden sun, silver-lined edges, the rays
// reading as light IN the hazy air. This pass is the fan. The lining lives in
// world/clouds.js; the two-layer deck is the day hand's `layers`.
//
// SOUSA-STYLE, three stages, all half-res but the composite:
//   1. MASK    sun visibility per pixel against a white sky: the dome's own coverage
//              field (water.js GLSL_SKY_COVERAGE, the same uniforms) painted first, the
//              scene depth gating everything that is not sky (the sea, the raft, Sal),
//              the horizon closing the bottom; then the puff clusters drawn on top as
//              alpha occluders (clouds.js cloudOccluder, same instanced geometry).
//   2. BLUR    two radial blurs toward the projected sun point, N taps each with an
//              exponential decay, the second at a sixth of the first's reach so the
//              first's banding is smoothed rather than repeated.
//   3. ADD     the fan, times the sun disc's hue, times the AIR (the marine haze's
//              K_AIR with the Flow-lean gain, the marine layer on top: no haze, no rays),
//              times the coverage WINDOW (0 at clear, peak 0.55..0.85, 0 under a lid),
//              weighted per pixel by the haze integral to the depth there (sky and far
//              sea get the whole fan; the deck's timber a few metres away gets the
//              few percent of air that is actually in front of it), soft-capped at a
//              share of the hole's own luminance so the brightest ray is always dimmer
//              than the sky it comes from. Values compressed, like the photo.
//
// PARANOIA (the GL_INVALID_OPERATION history in postfx.js):
//   * Two render targets, rtMask and rtBlur, owned here, never shared, no depth or
//     stencil attachment on either (nothing here depth-tests; the puff occluders are
//     drawn with depthTest off and the scene depth is read as a texture).
//   * Four draws, each writing a target it does not read: mask -> rtMask, puffs -> rtMask
//     (reads only the puff texture), blur1 rtMask -> rtBlur, blur2 rtBlur -> rtMask,
//     composite rtMask + input + depth -> output.
//   * Skipped entirely (needsSwap = false, no buffer touched) underwater, at night,
//     with the sun > 40 degrees off-screen, outside the coverage window, at strength 0.
//   * Every program is compiled in the constructor (renderer.compile on the occluder
//     scene, a 1x1 warm render of the three fullscreen materials): nothing compiles at
//     runtime, which is also what keeps the first fan from hitching.
import * as THREE from 'three';
import { Pass } from 'postprocessing';
import { camera, renderer as coreRenderer } from './core.js';
import { sun } from './lighting.js';
import { GLASS, SUN } from './config.js';
import { GLSL_NOISE, GLSL_SKY_DECL, GLSL_SKY_COVERAGE, SKY_UNIFORMS, skyState, cloudLook, localSurfaceY, styleState } from './world/water.js';
import { cloudOccluder, cloudOccK } from './world/clouds.js';

const SUN_REF_I = 2.60;     // lighting.js STOPS[0].sunI, the same reference volumetrics uses
const K_AIR_G = 0.0040;     // water.js K_AIR green: the marine haze the rays are made of
const MAX_TAPS = 32;
const d2r = Math.PI / 180;

const VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4( position.xy, 1.0, 1.0 ); }`;

// Stage 1a. Sky coverage + depth gate + horizon, against white.
const MASK_FRAG = `
precision highp float;
uniform sampler2D tDepth;
uniform mat4 uCamW;
uniform vec2 uTanHalf;
uniform float uDomeK, uHorizon;
${GLSL_SKY_DECL}
varying vec2 vUv;
${GLSL_NOISE}
${GLSL_SKY_COVERAGE}
void main(){
  vec2 nd = vUv * 2.0 - 1.0;
  vec3 d = normalize( mat3( uCamW ) * vec3( nd * uTanHalf, -1.0 ) );
  // Not sky: anything the scene wrote depth for (the sea in air writes depth; the raft,
  // Sal, the davit). The dome sits at the far plane (w * 0.999999).
  float z = texture2D( tDepth, vUv ).x;
  float sky = step( 0.99995, z );
  // The bottom of the fan: the dome below the waterline is not sky either.
  sky *= smoothstep( -0.02, uHorizon, d.y );
  float amt = skyCloudAmt( d ) * uDomeK;
  gl_FragColor = vec4( vec3( sky * ( 1.0 - amt ) ), 1.0 );
}`;

// Stage 2. Radial blur toward the (clamped) sun point. The reach is a fraction of the
// pixel's own distance to the sun, so every pixel integrates the same share of its ray;
// the decay is per tap. Weights are normalised so a uniformly lit mask stays 1.
const BLUR_FRAG = `
precision highp float;
#define MAXT ${MAX_TAPS}
uniform sampler2D tSrc;
uniform vec2 uSun;
uniform float uReach, uDecay;
uniform int uTaps;
varying vec2 vUv;
void main(){
  vec2 toSun = uSun - vUv;
  vec2 step = toSun * uReach / float( uTaps );
  vec2 uv = vUv;
  float w = 1.0, sum = 0.0, wsum = 0.0;
  for ( int i = 0; i < MAXT; i++ ) {
    if ( i >= uTaps ) break;
    sum += texture2D( tSrc, uv ).r * w;
    wsum += w;
    w *= uDecay;
    uv += step;
  }
  gl_FragColor = vec4( vec3( sum / max( wsum, 1e-4 ) ), 1.0 );
}`;

// Stage 3. Additive composite, haze-weighted by depth, soft-capped.
const COMP_FRAG = `
precision highp float;
uniform sampler2D tDiffuse, tRays, tDepth;
uniform vec3 uCol;
uniform vec2 uSun;
uniform float uNear, uFar, uKAir, uNearK, uCap, uGain, uSunW, uShadow;
varying vec2 vUv;
float sceneT( float d ){ return -( ( uNear * uFar ) / ( ( uFar - uNear ) * d - uFar ) ); }
void main(){
  vec3 base = texture2D( tDiffuse, vUv ).rgb;
  // CONTRAST, NOT LEVEL. A clear sky's fan is uniform, and a uniform add is milk (the
  // sky already carries its own airlight). Crepuscular rays are the gaps between cloud
  // SHADOWS in the haze, so the fan is read against the frame's own mean visibility
  // (the mask's top mip): above it, lit haze, added; below it, shadowed haze, a gentle
  // darkening. A cloudless frame has r == mean everywhere and adds nothing.
  float r = texture2D( tRays, vUv ).r;
  float mean = textureLod( tRays, vec2( 0.5 ), 12.0 ).r;
  float lit = max( 0.0, r - mean );
  float shd = max( 0.0, mean - r );
  // THE AIR IN FRONT OF THIS PIXEL. A ray is scattered haze along the view path, so a
  // pixel gets the fan in proportion to 1 - exp( -K t ): the sky (t = far) gets it all,
  // the sea at 100 units a third, the deck's timber at 9 units a few percent.
  float t = sceneT( texture2D( tDepth, vUv ).x );
  float air = ( 1.0 - exp( -uKAir * t ) ) / ( 1.0 - exp( -uKAir * uFar ) );
  air = max( air, uNearK );
  // A little of the fan's own geometry: pixels nearer the sun point are brighter, the
  // way the photo's rays are strongest around the hole and pale toward the edges.
  float near = 1.0 - 0.45 * smoothstep( 0.15, 1.2, distance( vUv, uSun ) );
  float v = lit * air * near * uGain * uSunW;
  // SOFT CAP: the brightest ray is never more than uCap of the hole's own luminance.
  v = uCap * ( 1.0 - exp( -v / max( uCap, 1e-4 ) ) );
  base *= 1.0 - uShadow * shd * air * uSunW;
  gl_FragColor = vec4( base + uCol * v, 1.0 );
}`;

function fullscreenTri() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  return g;
}

// The hole's luminance for the cap. The dome is a ShaderMaterial without the tone-map
// chunk, so the sky lands in the buffer as its raw scene-linear radiance (water.js
// measured this); the clamp only guards a blown stop.
function holeLumOf(h) { return Math.max(0, Math.min(1.2, 0.2126 * h[0] + 0.7152 * h[1] + 0.0722 * h[2])); }

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export class SkyRaysPass extends Pass {
  constructor() {
    super('SkyRays');
    this.needsSwap = true;
    this.needsDepthTexture = true;

    const rtOpts = {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping
    };
    this.rtMask = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.rtMask.texture.name = 'SkyRays.Mask';
    // The mask target carries a mip chain: the composite reads its top mip as the
    // frame's mean visibility (three regenerates it at the end of every render into it).
    this.rtMask.texture.generateMipmaps = true;
    this.rtMask.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.rtBlur = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.rtBlur.texture.name = 'SkyRays.Blur';
    this.rtBlur.texture.generateMipmaps = false;

    const geo = fullscreenTri();
    const mkScene = (mat) => { const s = new THREE.Scene(); const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; s.add(m); return s; };

    this.maskMaterial = new THREE.ShaderMaterial({
      name: 'SkyRaysMask',
      uniforms: {
        tDepth: { value: null },
        uCamW: { value: new THREE.Matrix4() },
        uTanHalf: { value: new THREE.Vector2(1, 1) },
        uDomeK: { value: 0.85 }, uHorizon: { value: 0.03 },
        ...SKY_UNIFORMS
      },
      vertexShader: VERT, fragmentShader: MASK_FRAG, depthTest: false, depthWrite: false, toneMapped: false
    });
    this.maskScene = mkScene(this.maskMaterial);

    this.blurMaterial = new THREE.ShaderMaterial({
      name: 'SkyRaysBlur',
      uniforms: {
        tSrc: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) },
        uReach: { value: 0.4 }, uDecay: { value: 0.93 }, uTaps: { value: 24 }
      },
      vertexShader: VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false, toneMapped: false
    });
    this.blurScene = mkScene(this.blurMaterial);

    this.fullscreenMaterial = new THREE.ShaderMaterial({
      name: 'SkyRaysComposite',
      uniforms: {
        tDiffuse: { value: null }, tRays: { value: this.rtMask.texture }, tDepth: { value: null },
        uCol: { value: new THREE.Vector3(1, 0.95, 0.85) }, uSun: { value: new THREE.Vector2(0.5, 0.5) },
        uNear: { value: 0.1 }, uFar: { value: 700 }, uKAir: { value: K_AIR_G }, uNearK: { value: 0 },
        uCap: { value: 0.3 }, uGain: { value: 1 }, uSunW: { value: 1 }, uShadow: { value: 0.35 }
      },
      vertexShader: VERT, fragmentShader: COMP_FRAG, depthTest: false, depthWrite: false, toneMapped: false
    });

    this.resDiv = 2;
    this._w = 0; this._h = 0;
    // Probe state, read by window.__rays: why the pass skipped, the frame's weights.
    this.state = { on: false, why: 'boot', cov: 0, win: 0, off: 0, sunUV: [0, 0], air: 0, gain: 0, cap: 0, sunK: 0, frames: 0 };

    // BOOT COMPILE. Everything this pass will ever draw is compiled here. toneMapped is
    // FALSE on all four materials for a reason: three picks the tone-mapping program
    // variant by whether the CURRENT render target is the canvas, so a material compiled
    // against the canvas at boot and drawn into a target later is a second program,
    // compiled mid-game (measured: +4 programs on the first fan). With toneMapped off
    // the variant is the same either way, and the buffer is not tone-mapped here anyway. The occluder
    // scene exists once buildClouds has run (game.js builds the world before postfx's
    // first render, but this constructor runs at module scope), so it is compiled on the
    // first render if it was not ready here -- still before any real fan is drawn, and
    // exactly once.
    this._occCompiled = false;
    // GPU timer (EXT_disjoint_timer_query_webgl2, where the driver has it): the cost
    // claim in the report is measured, not asserted. Off until __rays.profile(true).
    this._prof = false; this._ext = null; this._q = []; this.gpuMs = []; this._cpuMs = 0;
    const r = coreRenderer;
    try {
      r.compile(this.maskScene, camera);
      r.compile(this.blurScene, camera);
      r.compile(this.scene, this.camera);
      this._compileOcc(r);
    } catch (e) { console.warn('SkyRays: boot compile', e); }
  }

  // Called by postfx.js's boot warm-up, after the world (and so the cloud occluder)
  // exists: the last program this pass can ever need is compiled here, before play.
  warmUp(r) { this._compileOcc(r); return this._occCompiled; }

  _compileOcc(r) {
    if (this._occCompiled) return;
    const occ = cloudOccluder();
    if (!occ) return;
    // compile() skips invisible objects; flip for the call only.
    const m = occ.children[0], was = m.visible;
    m.visible = true;
    try { r.compile(occ, camera); } finally { m.visible = was; }
    this._occCompiled = true;
  }

  setDepthTexture(depthTexture) {
    this.maskMaterial.uniforms.tDepth.value = depthTexture;
    this.fullscreenMaterial.uniforms.tDepth.value = depthTexture;
  }

  setResolutionDivisor(d) {
    const n = Math.max(1, Math.min(8, Math.round(d)));
    if (n === this.resDiv) return;
    this.resDiv = n;
    const w = this._w, h = this._h;
    this._w = 0; this._h = 0;
    if (w && h) this.setSize(w, h);
  }

  setSize(width, height) {
    const w = Math.max(1, Math.floor(width)), h = Math.max(1, Math.floor(height));
    if (w === this._w && h === this._h) return;
    this._w = w; this._h = h;
    const hw = Math.max(1, Math.ceil(w / this.resDiv)), hh = Math.max(1, Math.ceil(h / this.resDiv));
    this.rtMask.setSize(hw, hh);
    this.rtBlur.setSize(hw, hh);
  }

  render(renderer, inputBuffer, outputBuffer) {
    const R = GLASS.rays, S = this.state;
    const skip = (why) => { S.on = false; S.why = why; this.needsSwap = false; };

    // --- the gates -------------------------------------------------------------
    if (!(R.strength > 0.001)) return skip('strength');
    if (camera.position.y < localSurfaceY() - 2 || skyState.air < 0.5) return skip('underwater');
    const sunK = Math.max(0, sun.intensity) / SUN_REF_I;
    S.sunK = sunK;
    if (!(sunK > 0.02) || SUN.dir.y < 0.035 || skyState.discK < 0.05) return skip('night');
    const cov = skyState.cov;
    S.cov = cov;
    const W = R.window;
    // The coverage window, and the storm envelope on top of it: a gale's lid is a lid
    // before the coverage uniform has finished closing (env.sky lags the storm ~1 s and
    // the puffs are already sinking into the deck), so the fan dies with the envelope
    // too. Calm days: exactly 1.0.
    const win = sm(W[0], W[1], cov) * (1 - sm(W[2], W[3], cov)) * (1 - sm(0.30, 0.70, cloudLook.storm));
    S.win = win;
    if (win < 0.004) return skip(cov < W[1] ? 'clear' : 'lid');

    // The sun in view space; off-screen angle against the frustum's half-diagonal.
    const tan = Math.tan(camera.fov * d2r / 2);
    _v.set(SUN.dir.x, SUN.dir.y, SUN.dir.z).transformDirection(camera.matrixWorldInverse);
    const ang = Math.acos(Math.max(-1, Math.min(1, -_v.z)));
    const halfDiag = Math.atan(tan * Math.hypot(camera.aspect, 1));
    const off = Math.max(0, ang - halfDiag) / d2r;
    S.off = off;
    if (off > 40) return skip('offscreen');
    const offK = 1 - sm(18, 40, off);
    let sx, sy;
    if (_v.z < -0.02) {
      sx = 0.5 + 0.5 * (_v.x / -_v.z) / (tan * camera.aspect);
      sy = 0.5 + 0.5 * (_v.y / -_v.z) / tan;
    } else {
      // beside or behind the eye: push the point far out along its screen bearing
      const l = Math.hypot(_v.x, _v.y) || 1;
      sx = 0.5 + _v.x / l * 4; sy = 0.5 + _v.y / l * 4;
    }
    // Clamped to a padded rect so an off-screen sun still fans in from the edge.
    sx = Math.max(-0.75, Math.min(1.75, sx)); sy = Math.max(-0.75, Math.min(1.75, sy));
    S.sunUV[0] = sx; S.sunUV[1] = sy;

    // THE AIR. K_AIR with the Flow-lean haze gain (styleState()[0], the same number every
    // fogged program multiplies KAIR by), plus the marine layer's scattering. Normalised
    // at the shipped lean (0.6 -> 1.39x) so the defaults land at 1; a clear-air day at
    // lean 0 fans at 0.72, a foggy one brighter but fog also kills the disc (discK).
    const st = styleState();
    const airGain = 1 + st[0];
    const medium = (airGain + 1.6 * skyState.fog) / 1.39;
    S.air = medium;
    const gain = R.strength * win * offK * medium * skyState.discK * Math.min(1, sunK * 1.2);
    S.gain = gain;
    if (gain < 0.004) return skip('gain');

    // --- go ---------------------------------------------------------------------
    S.on = true; S.why = 'on'; S.frames++;
    this.needsSwap = true;
    this._compileOcc(renderer);
    const gl = renderer.getContext();
    let q = null;
    const t0 = performance.now();
    if (this._prof) {
      this._pollQueries(gl);
      if (this._ext) { q = gl.createQuery(); gl.beginQuery(this._ext.TIME_ELAPSED_EXT, q); }
    }

    // 1a. coverage mask
    const mu = this.maskMaterial.uniforms;
    mu.uCamW.value.copy(camera.matrixWorld);
    mu.uTanHalf.value.set(tan * camera.aspect, tan);
    // holeBias: the LOW deck owns the hole; the dome field and the high layer thin.
    mu.uDomeK.value = 0.9 * (1 - 0.55 * R.holeBias);
    renderer.setRenderTarget(this.rtMask);
    renderer.render(this.maskScene, this.camera);
    // 1b. the puffs as occluders, main camera, on top
    const occ = cloudOccluder();
    if (occ && occ.children[0].visible) {
      cloudOccK(1 - 0.6 * R.holeBias, 1);
      renderer.render(occ, camera);
    }

    // 2. two radial blurs
    const bu = this.blurMaterial.uniforms;
    bu.uSun.value.set(sx, sy);
    bu.uTaps.value = Math.max(4, Math.min(MAX_TAPS, R.taps | 0));
    bu.uDecay.value = Math.max(0.5, Math.min(0.995, R.decay));
    bu.tSrc.value = this.rtMask.texture;
    bu.uReach.value = R.reach;
    renderer.setRenderTarget(this.rtBlur);
    renderer.render(this.blurScene, this.camera);
    bu.tSrc.value = this.rtBlur.texture;
    bu.uReach.value = R.reach / 6;
    bu.uDecay.value = 1;
    renderer.setRenderTarget(this.rtMask);
    renderer.render(this.blurScene, this.camera);

    // 3. composite
    const cu = this.fullscreenMaterial.uniforms;
    cu.tDiffuse.value = inputBuffer.texture;
    cu.tRays.value = this.rtMask.texture;
    cu.uSun.value.set(sx, sy);
    cu.uNear.value = camera.near; cu.uFar.value = camera.far;
    cu.uKAir.value = K_AIR_G * airGain;
    cu.uNearK.value = Math.max(0, Math.min(1, R.nearK));
    // Colour: the sun disc palette (water.js), hue only.
    const d = skyState.disc, m = Math.max(d[0], d[1], d[2], 1e-4);
    // Pale, slightly warm: pulled a third toward white so noon's fan is silver-grey and
    // dusk's is amber, never a saturated orange.
    cu.uCol.value.set(0.67 + 0.33 * d[0] / m, 0.67 + 0.33 * d[1] / m, 0.67 + 0.33 * d[2] / m);
    // The hole's luminance, display-referred, is the cap.
    const holeLum = holeLumOf(skyState.hor);
    cu.uCap.value = Math.max(0.02, R.cap * holeLum);
    S.cap = cu.uCap.value;
    cu.uGain.value = gain * R.gainK;
    cu.uShadow.value = R.shadow * win * offK * skyState.discK * Math.min(1, R.strength);
    // Looking toward the sun the fan is brightest (forward scatter); across it, half.
    camera.getWorldDirection(_fwd);
    cu.uSunW.value = 0.5 + 0.5 * Math.max(0, _fwd.x * SUN.dir.x + _fwd.y * SUN.dir.y + _fwd.z * SUN.dir.z);
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
    if (q) { gl.endQuery(this._ext.TIME_ELAPSED_EXT); this._q.push(q); }
    if (this._prof) this._cpuMs = performance.now() - t0;
  }

  profile(on) {
    this._prof = !!on;
    if (on && !this._ext) this._ext = coreRenderer.getContext().getExtension('EXT_disjoint_timer_query_webgl2');
    if (on) this.gpuMs.length = 0;
    return { ext: !!this._ext };
  }
  _pollQueries(gl) {
    const ext = this._ext;
    if (!ext) return;
    while (this._q.length) {
      const q = this._q[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const dis = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      gl.deleteQuery(q); this._q.shift();
      if (!dis) { this.gpuMs.push(ns / 1e6); if (this.gpuMs.length > 240) this.gpuMs.shift(); }
    }
  }

  dispose() {
    this.rtMask.dispose(); this.rtBlur.dispose();
    this.maskMaterial.dispose(); this.blurMaterial.dispose();
    if (this.fullscreenMaterial) this.fullscreenMaterial.dispose();
  }
}

function sm(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
