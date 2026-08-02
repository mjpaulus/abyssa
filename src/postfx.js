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
  VignetteEffect, NoiseEffect, ChromaticAberrationEffect, BlendFunction,
  KernelSize, NormalPass, SSAOEffect, SMAAEffect, SMAAPreset, DepthCopyPass
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { renderer, scene, camera, onResize } from './core.js';
import { playerLightSrc } from './lighting.js';
// --- VOLUMETRICS INTEGRATION (import) ---
import { VolumetricLightPass } from './postfx.volumetrics.js';
// --- END VOLUMETRICS INTEGRATION ---

// Tone mapping on the renderer: it is baked into every material's fragment output at
// scene-render time, so it applies identically through the composer and the bypass.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// Raised from 1.05 for the luminous-shallows look: the fixed exposure has to carry what
// the benched auto-exposure pass used to. Zone 2 stays dark because its light sources
// are dark, not because the exposure is low.
renderer.toneMappingExposure = 1.32;

export const composer = new EffectComposer(renderer, { multisampling: 0 });
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
const vignette = new VignetteEffect({ darkness: 0.55, offset: 0.28 });
const grain = new NoiseEffect({ blendFunction: BlendFunction.COLOR_DODGE });
grain.blendMode.opacity.value = 0.06;
const chroma = new ChromaticAberrationEffect({
  offset: new THREE.Vector2(0.0009, 0.0006), radialModulation: true, modulationOffset: 0.35
});

// SMAA replaces the MSAA we disabled during the black-box investigation: it runs
// inside the effect chain, so it cannot reintroduce the resolve-blit that flashed.
const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });

let effects = [dof, bloom, chroma, vignette, grain];
let normalPass = null, effectPass = null, n8aoPass = null;
// Prefer N8AO (ground-truth-ish AO, far richer contact shading than the old SSAO);
// fall back to the previous NormalPass+SSAO stack, then to no AO at all. Each tier
// is a strict subset of the last known-good pipeline, so the P-key A/B stays valid.
try {
  n8aoPass = new N8AOPostPass(scene, camera, innerWidth, innerHeight);
  n8aoPass.configuration.aoRadius = 2.2;
  n8aoPass.configuration.distanceFalloff = 5.0;
  n8aoPass.configuration.intensity = 2.6;
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
// SMAA is a convolution effect and cannot share a pass with ChromaticAberration;
// it runs last so it smooths the whole graded frame.
const smaaPass = new EffectPass(camera, smaa);
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
  // Uniform name varies across postprocessing versions; missing it just means a fixed focus.
  const fu = dof.cocMaterial.uniforms && dof.cocMaterial.uniforms.focusDistance;
  if (fu) fu.value = focusDist / camera.far;
  composer.render(dt);
}

// Adaptive quality: sample real framerate after warmup, shed expensive passes once.
let perfT = 0, perfN = 0, perfDone = false;

function degradeQuality() {
  // --- VOLUMETRICS INTEGRATION (degradeQuality removal hook) ---
  setVolumetrics(false);
  // --- END VOLUMETRICS INTEGRATION ---
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
    effectPass = new EffectPass(camera, dof, bloom, chroma, vignette, grain);
    composer.addPass(effectPass);
    composer.addPass(smaaPass);   // re-append so SMAA stays last
  }
  useDepthCopy();
  console.info('ABYSSA: reduced quality mode (AO/shadows off)');
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
  if (badT >= SUSTAIN) { degradeQuality(); perfDone = true; }
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
