// Post-processing stack + adaptive quality. OWNED BY: orchestrator.
//
// This is the deliberately SIMPLE library stack. A five-pass custom chain (eye
// adaptation, quarter-res light shafts, defocus, ASC-CDL grade) lived here and was
// confirmed by live A/B (P-key bypass) to intermittently paint flashing black
// rectangles over the frame on real hardware; it is preserved unimported in
// postfx.cinematic.js.off. Rehab it pass-by-pass against that same A/B before any
// of it comes back.
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, DepthOfFieldEffect,
  VignetteEffect, ChromaticAberrationEffect, BlendFunction, Effect,
  KernelSize, NormalPass, SSAOEffect, SMAAEffect, SMAAPreset, DepthCopyPass
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { SURFACE_Y } from './config.js';
import { renderer, scene, camera, onResize } from './core.js';
import { playerLightSrc, parkSunShadow } from './lighting.js';
// --- VOLUMETRICS INTEGRATION (import) ---
import { VolumetricLightPass } from './postfx.volumetrics.js';
import { degradeRefraction, reduceRefraction } from './world/water.js';
// --- END VOLUMETRICS INTEGRATION ---

// Tone mapping on the renderer: it is baked into every material's fragment output at
// scene-render time, so it applies identically through the composer and the bypass.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// Raised from 1.05 for the luminous-shallows look: the fixed exposure has to carry what
// the benched auto-exposure pass used to. Zone 2 stays dark because its light sources
// are dark, not because the exposure is low.
renderer.toneMappingExposure = 1.32;

// HalfFloat intermediates: tone mapping is baked at scene render (renderer-level
// ACES), so the data through the chain is display-referred either way — the win is
// PRECISION. 8-bit unorm buffers quantised every deep-water gradient to 256 steps
// per channel and clipped every intermediate (bloom mips, DoF CoC blends) at 1.0.
export const composer = new EffectComposer(renderer, {
  multisampling: 0, frameBufferType: THREE.HalfFloatType
});
composer.addPass(new RenderPass(scene, camera));

// The composer attaches its DepthTexture to only ONE of its two ping-pong buffers.
// With N8AO in the chain the swap parity lands so that the next depth-sampling pass
// (volumetrics composite, or the DoF EffectPass when volumetrics is absent) draws
// INTO that buffer while sampling its depth attachment — a GL feedback loop
// (GL_INVALID_OPERATION 1282 on every frame). Fix: copy scene depth into a target
// no pass ever renders to, and point every depth consumer at the copy (see
// useDepthCopy below). Raw float copy, so consumers see bit-identical depth.
const depthCopy = new DepthCopyPass({ depthPacking: THREE.BasicDepthPacking });
composer.addPass(depthCopy);

const bloom = new BloomEffect({
  intensity: 1.1, luminanceThreshold: 0.28, luminanceSmoothing: 0.25,
  kernelSize: KernelSize.LARGE, mipmapBlur: true
});
// bokehScale kept modest: the half-res CoC upsample stair-steps on bright edges (the
// lantern pool) once the blur radius gets large.
const dof = new DepthOfFieldEffect(camera, { focusDistance: 9 / 700, focalLength: 0.06, bokehScale: 1.35 });
// Same 6.39 world-units shift as the per-frame focus write below: the constructor's
// normalized focusRange/focalLength (0.06 of camera.far = 42 world units of sharp
// band on 6.35) lands raw in the new CoC material — 6cm of focus. Restore the
// shipped band through the world-unit accessors when they exist.
if ('worldFocusRange' in dof.cocMaterial) dof.cocMaterial.worldFocusRange = 0.06 * 700;
const vignette = new VignetteEffect({ darkness: 0.55, offset: 0.28 });
// Shadow-weighted film grain (ported from the benched cinematic grade, which weighted
// grain by 1 - smoothstep(0, 0.75, luminance)). The old NoiseEffect ran COLOR_DODGE,
// which divides by (1 - noise): on the near-black murk that AMPLIFIES the noise
// exactly where a dark game needs it quietest. This adds a zero-mean hash grain that
// rides the shadows and dies in the highlights — texture in the murk, clean lantern.
class GrainEffect extends Effect {
  constructor() {
    super('AbyssaGrain', `
      uniform float uAmount;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
        // fract(time * phi): the old fract(time) re-rolled the pattern once per SECOND
        // (integer crossings), a visible 1 Hz tick on a still camera in murk. The
        // golden-ratio rate never revisits an offset and re-rolls every frame.
        float g = fract(sin(dot(uv * resolution + fract(time * 0.6180339887) * 91.7, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
        vec3 c = inputColor.rgb + g * uAmount * (1.0 - smoothstep(0.0, 0.75, luminance(inputColor.rgb)));
        // Unweighted zero-mean dither at +-0.5/255: breaks up 8-bit quantisation bands
        // on smooth mid-tone water gradients, where the shadow-weighted grain above has
        // already faded out. Sub-LSB amplitude, so it is invisible as texture.
        c += g * 0.0039215686;
        outputColor = vec4(max(c, 0.0), inputColor.a);
      }`, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([['uAmount', new THREE.Uniform(0.045)]])
    });
  }
}
const grain = new GrainEffect();
// NaN/Inf scrub (concept from the benched chain): a 0/0 in a fog or water term can
// emit NaN into the buffer, and every comparison against NaN is false, so the clamp
// is written comparison-first. Runs LAST in the main EffectPass, after DoF and the
// mipmap-bloom contribution have been blended, so nothing bad leaves the pass.
// SCOPE: this scrubs the merged-pass OUTPUT only. A NaN that enters bloom's or DoF's
// internal render targets (mip chain, CoC buffer) propagates inside those effects
// unprotected — guarding that would need material-level fixes at the NaN's source.
class FiniteEffect extends Effect {
  constructor() {
    super('AbyssaFinite', `
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
        vec3 v = inputColor.rgb;
        outputColor = vec4(v.x > 0.0 ? min(v.x, 64.0) : 0.0,
                           v.y > 0.0 ? min(v.y, 64.0) : 0.0,
                           v.z > 0.0 ? min(v.z, 64.0) : 0.0, inputColor.a);
      }`, { blendFunction: BlendFunction.NORMAL, uniforms: new Map() });
  }
}
const finite = new FiniteEffect();
// Depth-driven ASC-CDL grade (rehabbed from the benched chain's LOOKS table as a
// static-uniform effect — no extra pass, no render targets, so none of the machinery
// that flashed). EXTREMELY subtle by design: window.__grade.amount scales the whole
// departure from neutral (0 = bit-identical off, default barely-there); the user
// judges the look by eye and owns the knob.
class GradeEffect extends Effect {
  constructor() {
    super('AbyssaGrade', `
      uniform vec3 uSlope, uOffset, uPower;
      uniform float uSat;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
        vec3 c = max(inputColor.rgb, 0.0);
        c = pow(c, vec3(0.4545454));
        c = pow(max(c * uSlope + uOffset, 0.0), uPower);
        c = mix(vec3(luminance(c)), c, uSat);
        outputColor = vec4(pow(max(c, 0.0), vec3(2.2)), inputColor.a);
      }`, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uSlope', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['uOffset', new THREE.Uniform(new THREE.Vector3(0, 0, 0))],
        ['uPower', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['uSat', new THREE.Uniform(1)]
      ])
    });
  }
}
const grade = new GradeEffect();
// Shallow / deep look stops (the benched LOOKS, softened): cool slope and lifted
// blue offset deepening with depth. Lerped by depth, then the whole thing lerped
// toward neutral by __grade.amount.
const GRADE_LOOKS = [
  { slope: [0.99, 1.02, 1.01], offset: [0.006, 0.008, 0.010], power: [1.01, 1.00, 1.00], sat: 1.06 },
  { slope: [0.93, 0.95, 1.03], offset: [0.004, 0.006, 0.010], power: [1.05, 1.03, 1.00], sat: 1.04 }
];
const __grade = { amount: 0.15 };
if (typeof window !== 'undefined') window.__grade = __grade;
const _gv = new THREE.Vector3();
// Uniform refs cached once (zero-alloc convention): the old loop built
// 'u' + key[0].toUpperCase() + key.slice(1) strings every frame.
const _gradeU = {
  slope: grade.uniforms.get('uSlope'),
  offset: grade.uniforms.get('uOffset'),
  power: grade.uniforms.get('uPower'),
  sat: grade.uniforms.get('uSat')
};
const _gradeKeys = ['slope', 'offset', 'power'];
function updateGrade() {
  const k = Math.max(0, Math.min(1, __grade.amount));
  if (k <= 0.001) {
    _gradeU.slope.value.set(1, 1, 1); _gradeU.offset.value.set(0, 0, 0);
    _gradeU.power.value.set(1, 1, 1); _gradeU.sat.value = 1;
    return;
  }
  // Depth ramp runs the full column (~-900), not just to -650: the shipped look
  // lands unchanged at -650 (d = 1 there), then drifts a touch deeper and quieter
  // to -900 — the abyss keeps darkening character without changing hue.
  const y = -camera.position.y;
  const d = Math.min(1, y / 650) + Math.max(0, Math.min(1, (y - 650) / 250)) * 0.18;
  const a = GRADE_LOOKS[0], b = GRADE_LOOKS[1];
  for (const key of _gradeKeys) {
    const neutral = key === 'offset' ? 0 : 1;
    _gv.set(0, 0, 0);
    for (let i = 0; i < 3; i++) {
      const v = a[key][i] + (b[key][i] - a[key][i]) * d;
      _gv.setComponent(i, neutral + (v - neutral) * k);
    }
    _gradeU[key].value.copy(_gv);
  }
  _gradeU.sat.value = 1 + (a.sat + (b.sat - a.sat) * d - 1) * k;
}
// Equal offset components: radialModulation does the directional shaping, and an
// asymmetric base offset read as a diagonal smear on wide windows.
const chroma = new ChromaticAberrationEffect({
  offset: new THREE.Vector2(0.0008, 0.0008), radialModulation: true, modulationOffset: 0.35
});

// SMAA replaces the MSAA we disabled during the black-box investigation: it runs
// inside the effect chain, so it cannot reintroduce the resolve-blit that flashed.
const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });

// Vignette and grain moved OUT of this pass: they used to run before SMAA, which
// then smoothed the grain like an edge. They now live with SMAA in the final pass.
// NOTE: the library does NOT reorder effects — they run in the order given (and it
// throws on >1 convolution effect per pass) — so SMAA must be listed FIRST in that
// pass by hand, and it is. Zero extra passes; grain lands on the antialiased frame.
let effects = [dof, bloom, chroma, grade, finite];
let normalPass = null, effectPass = null, n8aoPass = null;
// Prefer N8AO (ground-truth-ish AO, far richer contact shading than the old SSAO);
// fall back to the previous NormalPass+SSAO stack, then to no AO at all. Each tier
// is a strict subset of the last known-good pipeline, so the P-key A/B stays valid.
try {
  n8aoPass = new N8AOPostPass(scene, camera, innerWidth, innerHeight);
  // A/B'd on the deck at noon (2.2/2.6 vs 1.0/3.0): the deck props are 0.1-0.5u, and
  // at radius 2.2 the AO read as a broad depth-grade darkening — open plank runs went
  // muddy while the gear never visibly seated. Radius 1.0 pulls the occlusion into the
  // contacts (gear feet, bulwark roots, davit base) and cleans the open deck; the
  // intensity nudge to 3.0 keeps the total AO weight in the frame comparable.
  n8aoPass.configuration.aoRadius = 1.0;
  n8aoPass.configuration.distanceFalloff = 5.0;
  n8aoPass.configuration.intensity = 3.0;
  n8aoPass.configuration.halfRes = true;
  composer.addPass(n8aoPass);
} catch (e) {
  console.warn('N8AO unavailable, falling back to SSAO:', e);
  try {
    normalPass = new NormalPass(scene, camera, { resolutionScale: 0.5 });
    composer.addPass(normalPass);
    const ssao = new SSAOEffect(camera, normalPass.texture, {
      blendFunction: BlendFunction.MULTIPLY, samples: 9, rings: 4, resolutionScale: 0.5,
      distanceThreshold: 0.6, distanceFalloff: 0.1, rangeThreshold: 0.012, rangeFalloff: 0.004,
      luminanceInfluence: 0.6, radius: 0.08, intensity: 1.6, bias: 0.02
    });
    effects = [ssao, ...effects];
  } catch (e2) {
    console.warn('SSAO unavailable:', e2);
  }
}
effectPass = new EffectPass(camera, ...effects);
composer.addPass(effectPass);
// SMAA is a convolution effect and cannot share a pass with ChromaticAberration; it
// runs last so it smooths the whole graded frame. Vignette and grain ride the same
// pass, listed AFTER it — the library runs effects in the order GIVEN (it does not
// sort convolutions first), so this argument order is what keeps grain unblurred.
const smaaPass = new EffectPass(camera, smaa, vignette, grain);
composer.addPass(smaaPass);

// composer.addPass() rewires every pass to the live depth attachment, so this must
// run after ANY addPass that creates or re-adds a depth-sampling pass.
function useDepthCopy() {
  if (effectPass) effectPass.setDepthTexture(depthCopy.texture);
  if (volPass) volPass.setDepthTexture(depthCopy.texture);
}

// --- VOLUMETRICS INTEGRATION (pass insertion + kill switch) ---
// Inserted after N8AO and before the effect chain, so bloom/DoF/grade all act on the
// shafts. Behind try/catch: if the pass fails to build, the stack is unchanged.
let volPass = null;
try {
  volPass = new VolumetricLightPass();
  composer.addPass(volPass, composer.passes.indexOf(effectPass));
} catch (e) {
  console.warn('Volumetric light shafts unavailable:', e);
  volPass = null;
}
useDepthCopy();
// Runtime kill switch: removes the pass from the composer entirely (not just
// disables it), so a suspect pass can be taken out of the chain during an A/B.
export function setVolumetrics(on) {
  if (on) {
    if (volPass || !effectPass) return false;
    try {
      volPass = new VolumetricLightPass();
      composer.addPass(volPass, composer.passes.indexOf(effectPass));
      useDepthCopy();
    } catch (e) { console.warn('Volumetrics re-enable failed:', e); volPass = null; }
    return !!volPass;
  }
  if (!volPass) return false;
  composer.removePass(volPass);
  volPass.dispose();
  volPass = null;
  return true;
}
export function getVolumetrics() { return !!volPass; }
export function getVolumetricPass() { return volPass; }
// --- END VOLUMETRICS INTEGRATION ---

onResize((w, h) => composer.setSize(w, h, false));

// Focus tracks the diver (playerLightSrc rides him) with a lens-like lag.
const focusTarget = new THREE.Vector3();
let focusDist = 9;
let air = 0;

// Diagnostic escape hatch (P key): render the scene straight to the canvas. Tone
// mapping lives on the renderer, so bypass and composer output match in exposure.
let bypass = false;
export function setPostBypass(on) { bypass = on; }
export function getPostBypass() { return bypass; }

export function render(dt) {
  if (bypass) {
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    return;
  }
  focusTarget.copy(playerLightSrc.position);
  const want = THREE.MathUtils.clamp(camera.position.distanceTo(focusTarget), 3, 40);
  focusDist += (want - focusDist) * Math.min(1, (dt || 0.016) * 3.5);
  // postprocessing >= 6.39 reads focus in WORLD units via the cocMaterial accessors;
  // 6.35 read the raw uniform NORMALIZED by camera.far. Writing the normalized value
  // into the 6.39 uniform focused the camera ~1cm in front of the lens and blurred the
  // whole world (user-reported: "everything looks blurry and lowres"). The uniform NAME
  // survived the upgrade; its MEANING didn't — poke the accessor, not the uniform.
  const cm = dof.cocMaterial;
  if ('worldFocusDistance' in cm) cm.worldFocusDistance = focusDist;
  else if (cm.uniforms && cm.uniforms.focusDistance) cm.uniforms.focusDistance.value = focusDist / camera.far;
  // ON DECK the water's shallow depth of field is wrong: air is clear, and the 42-unit
  // focus band + 3-40 focus clamp blurred the horizon from the raft. Same 1.6-unit
  // air/water blend lighting.js uses for its regime change, so the lens and the light
  // cross the surface together. In air the band opens ~4x and the bokeh nearly closes;
  // below the interface every frame is byte-identical to before.
  // The blend is LAGGED like focusDist: recomputing it instantly from camera.y made
  // background sharpness pulse at wave frequency in a swell (the camera bobs across
  // the 1.6-unit band every trough), a visible focus "breathing" from the deck.
  const airWant = THREE.MathUtils.clamp((camera.position.y - SURFACE_Y + 0.6) / 1.6, 0, 1);
  air += (airWant - air) * Math.min(1, (dt || 0.016) * 3.5);
  if ('worldFocusRange' in cm) cm.worldFocusRange = 42 * (1 + 3 * air);
  dof.bokehScale = 1.35 * (1 - air) + 0.15 * air;
  updateGrade();
  composer.render(dt);
}

// Adaptive quality: sample real framerate after warmup, shed expensive passes once.
let perfT = 0, perfN = 0, perfDone = false;

// A LADDER, not a hammer. The first miss used to shed EVERYTHING at once — and with
// the refraction pass first on the list, a machine that dipped under the bar for four
// seconds lost the sea's transparency permanently (user-reported twice: "starts out
// transparent and then drops back", with a frame showing shadows gone too, i.e. the
// full shed had fired). The sea being a window is a headline feature now; it goes
// LAST. Each rung gets its own fresh SUSTAIN of evidence before the next fires:
//   1. refraction target quartered      (~4x cheaper, transparency kept)
//   2. volumetrics cheapened            (occlusion march off, third-res march;
//                                        the shafts survive, softer and ~4x cheaper)
//   3. volumetrics + AO off             (the two historically-heaviest passes)
//   4. full shed                        (shadows, simplified chain, refraction gone)
let degradeStage = 0;
function degradeQuality() {
  degradeStage++;
  if (degradeStage === 1) {
    reduceRefraction();
    console.info('ABYSSA: perf tier 1 — refraction target quartered');
    return false;
  }
  if (degradeStage === 2) {
    if (volPass) {
      volPass.occlusion = false;
      volPass.setResolutionDivisor(3);
    }
    console.info('ABYSSA: perf tier 2 — volumetrics cheapened (no occlusion, third-res)');
    return false;
  }
  if (degradeStage === 3) {
    setVolumetrics(false);
    if (n8aoPass) { composer.removePass(n8aoPass); n8aoPass = null; }
    // The sun shadow is raft-only cosmetics; it goes long before transparency does.
    parkSunShadow();
    console.info('ABYSSA: perf tier 3 — volumetrics, AO and sun shadow off');
    return false;
  }
  degradeRefraction();
  renderer.shadowMap.enabled = false;
  scene.traverse(o => { if (o.isLight) o.castShadow = false; });
  if (n8aoPass) {
    composer.removePass(n8aoPass);
    n8aoPass = null;
  }
  if (normalPass) {
    composer.removePass(effectPass);
    composer.removePass(normalPass);
    composer.removePass(smaaPass);
    normalPass = null;
    effectPass = new EffectPass(camera, dof, bloom, chroma, grade, finite);
    composer.addPass(effectPass);
    composer.addPass(smaaPass);   // re-append so SMAA (+ vignette/grain) stays last
  }
  useDepthCopy();
  console.info('ABYSSA: reduced quality mode (AO/shadows off)');
  return true;
}

// Debug surface, kept: lets a session force the ladder rung by rung instead of waiting
// four sustained seconds under the bar per tier, and lets a player report which tier
// their machine landed on ("what does __perf.stage() say?").
if (typeof window !== 'undefined') {
  window.__perf = { degrade: degradeQuality, stage: () => degradeStage };
}

// This used to average the FIRST six seconds of play and degrade below 34 fps — which
// meant it was grading the warmup, not the machine. Those six seconds contain shader
// compilation for ~75 programs, texture uploads and first-touch costs, so it tripped on
// hardware that then runs at a steady 60, and every session logged "reduced quality
// mode". The cost was silent and permanent: no volumetrics, no AO, no shadows, for the
// whole game. Two changes make it honest.
//   1. WARMUP is skipped outright. game.js precompiles at boot, but the first frames of
//      real play still touch buffers nothing has bound yet.
//   2. A single bad average is not enough. The frame rate has to stay under the bar for
//      SUSTAIN seconds of genuinely-sampled time, so one hitch cannot cost the player
//      the whole render pipeline.
const WARMUP = 2.0, WINDOW = 1.0, SUSTAIN = 4.0, FPS_BAR = 34;
let warmT = 0, winT2 = 0, winN = 0, badT = 0, lastT = 0;

export function samplePerf(dt, active) {
  if (perfDone) return;
  // Reset the clock whenever sampling is not running, or the gap across a title screen
  // or an ending gets counted as one enormous frame.
  if (!active) { lastT = 0; return; }

  // Measure WALL TIME here rather than trusting the caller's dt. game.js passes
  // Math.min(0.05, clock.getDelta()), so dt is CLAMPED before it arrives: a frame that
  // really took 500 ms is indistinguishable from one that took 50, and a throttled
  // stretch reads as a steady 20 fps instead of being discarded. That clamp is correct
  // for physics (it stops a stall from teleporting the diver) and fatal for a perf
  // judge — it is why this degraded on a machine measured at 54 fps steady.
  const now = performance.now();
  if (!lastT) { lastT = now; return; }
  const real = (now - lastT) / 1000;
  lastT = now;

  // A backgrounded tab throttles rAF toward zero. Those frames say nothing about the
  // GPU, and without this the player loses the whole render pipeline for alt-tabbing.
  if (document.hidden || real > 0.25) return;
  if (warmT < WARMUP) { warmT += real; return; }

  winT2 += real; winN++;
  if (winT2 < WINDOW) return;
  const fps = winN / winT2;
  winT2 = 0; winN = 0;

  badT = fps < FPS_BAR ? badT + WINDOW : 0;
  // Each tier gets its own fresh SUSTAIN of evidence: the clock resets after a shed,
  // so tier 2 only fires if the machine STAYS under the bar with tier 1 applied.
  if (badT >= SUSTAIN) { if (degradeQuality()) perfDone = true; badT = 0; }
}

// Called by the boot loader once every material has a compiled program, so the sampler
// never sees a compile hitch. Cheap and idempotent.
export function warmUp() {
  const hidden = [];
  scene.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  try { renderer.compile(scene, camera); } catch (e) { console.warn('ABYSSA: precompile failed', e); }
  for (const o of hidden) o.visible = false;
  return renderer.info.programs.length;
}
// The same warm-up, asynchronous: r184's compileAsync uses KHR_parallel_shader_compile
// where the driver has it, so the boot loader covers the compile without the main
// thread stalling on each program. Rejects where unsupported; game.js falls back.
export async function warmUpAsync() {
  if (!renderer.compileAsync) throw new Error('no compileAsync');
  const hidden = [];
  scene.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  try { await renderer.compileAsync(scene, camera); }
  finally { for (const o of hidden) o.visible = false; }
  return renderer.info.programs.length;
}
