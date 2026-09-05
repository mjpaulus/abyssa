// THE PAINT LAW + the shared style uniforms (roadmap/flow-lean-style.md items 1, 2, 7).
// OWNED BY: materials agent (fl-materials).
//
// One pure function of the dial, applied to every generated PBR material at build and
// re-applied live when the knob moves. Each material's AUTHORED values are stored once
// (userData.paint) so the law never compounds: apply(k) always starts from the author.
//
//   roughness  = max(authored, 0.75 * k)                 the matte floor rises toward 0.75
//   metalness  = authored * (1 - k)   if authored < 0.5  non-metals lose their sheen
//              = authored             otherwise          real metal stays metal
//   normalScale= authored * (1 - 0.5 * k)                relief reads as brushwork
//
// HERO EXCEPTIONS (registerPaint(m, { hero: true }) — untouched at every k): brass and
// copper on Sal and the raft, the lantern glass, wreck brass/glass/lit lamps, Sal's port
// glass and bubbles, the squid ink sacs. Ward runes and the sea's glitter are not
// materials of this module and are untouched by construction.
//
// Every term is bit-identical to the shipped look at styleK() === 0.
import * as THREE from 'three';
import { GLASS, SUN, styleK } from '../config.js';

const REG = [];
let lastPaint = -1, lastEdge = -1, lastStrokes = -1;

// Shared uniforms: ONE object per knob, spread into every injected shader so a single
// value write reaches all programs. (Same idiom as flora's uni / triplanar's pbrUniforms.)
export const styleUniforms = {
  uPaintK:  { value: 0 },                       // paint law strength (rock roughness floor in-shader)
  uEdgeK:   { value: 0 },                       // edge-not-middle: k = styleK('edge') * 0.8
  uEdgeSun: { value: new THREE.Vector3(0, 1, 0) }, // SUN.dirWater, the pre-detail key direction
  uStrokeK: { value: 0 }                        // silhouette strokes: styleK('strokes') * 0.35
};

function apply(m, k) {
  const a = m.userData.paint;
  if (!a || a.hero) return;
  m.roughness = Math.max(a.rough, 0.75 * k);
  m.metalness = a.metal < 0.5 ? a.metal * (1 - k) : a.metal;
  if (a.ns && m.normalScale) m.normalScale.set(a.ns.x * (1 - 0.5 * k), a.ns.y * (1 - 0.5 * k));
}

// Register a material under the law. Idempotent (re-registering keeps the first
// authored snapshot). Returns the material so it can wrap a constructor call.
export function registerPaint(m, o = {}) {
  if (!m || !m.isMaterial) return m;
  if (!m.userData.paint) {
    m.userData.paint = {
      hero: !!o.hero,
      rough: m.roughness ?? 1, metal: m.metalness ?? 0,
      ns: (m.normalMap && m.normalScale) ? m.normalScale.clone() : null
    };
    REG.push(m);
  }
  apply(m, lastPaint < 0 ? styleK('paint') : lastPaint);
  return m;
}

// Re-apply the law from the authored snapshots. Pure in k; safe to call every frame
// (styleTick below does it only when the knob actually moved).
export function applyPaintLaw(k = styleK('paint')) {
  lastPaint = k;
  styleUniforms.uPaintK.value = k;
  for (let i = 0; i < REG.length; i++) apply(REG[i], k);
}

// The one cheap per-frame poll: three float compares and a vec3 copy.
export function styleTick() {
  const p = styleK('paint');
  if (p !== lastPaint) applyPaintLaw(p);
  const e = styleK('edge') * 0.8;
  if (e !== lastEdge) { lastEdge = e; styleUniforms.uEdgeK.value = e; }
  const s = styleK('strokes') * 0.35;
  if (s !== lastStrokes) { lastStrokes = s; styleUniforms.uStrokeK.value = s; }
  const d = SUN.dirWater;
  styleUniforms.uEdgeSun.value.set(d.x, d.y, d.z);
}

export const paintCount = () => REG.length;

// ---------------------------------------------------------------------------
// GLSL.
// EDGE-NOT-MIDDLE (item 2). Detail contrast scales by 1 - k * smoothstep(0.35, 0.8, L)
// where L is the pre-detail diffuse response of the GEOMETRIC world normal: the key
// (sun through the surface, or the lantern from above) blended with a sky hemisphere.
// Texture survives in the shadow/edge transitions and dissolves on lit faces.
// Declared as a function of the world normal so triplanar and the rock path share it.
// ---------------------------------------------------------------------------
export const EDGE_GLSL = /* glsl */`
uniform float uEdgeK; uniform vec3 uEdgeSun;
float edgeFlat(vec3 wN) {
  float lum = 0.6 * max(dot(wN, uEdgeSun), 0.0) + 0.4 * (0.5 + 0.5 * wN.y);
  return 1.0 - uEdgeK * smoothstep(0.35, 0.8, lum);
}
`;

// SILHOUETTE STROKES (item 7). Organic materials only. A view-angle Fresnel of the
// GEOMETRIC normal (vNormal, never the perturbed one) resolved to ~2.2 px by fwidth,
// darkened, broken by the IGN hash so the band frays rather than lines, and faded by
// screen footprint so a distant fish never grows a cel outline. Injected after
// color_fragment: diffuseColor.a is reduced too, which the alpha-hash path (fauna)
// turns into real fraying; opaque programs simply ignore the alpha.
// Uses nothing but varyings every MeshStandardMaterial already has.
export const STROKE_GLSL = /* glsl */`
uniform float uStrokeK;
`;
export const STROKE_BODY = /* glsl */`
if (uStrokeK > 0.0) {
  #ifdef FLAT_SHADED
    vec3 skGN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
  #else
    vec3 skGN = normalize(vNormal);
  #endif
  float skN = abs(dot(skGN, normalize(vViewPosition)));
  float skW = max(fwidth(skN), 0.0001) * 2.2;
  float skRim = 1.0 - smoothstep(0.0, skW, skN);
  float skFp = 1.0 - smoothstep(0.03, 0.12, length(fwidth(vViewPosition)));
  float skH = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float skBreak = step(skH, 0.35 + 0.65 * skRim);
  float sk = uStrokeK * skRim * skBreak * skFp;
  diffuseColor.rgb *= 1.0 - sk;
  diffuseColor.a *= 1.0 - sk * 1.6 * skH;
}
`;

// Convenience for the onBeforeCompile paths: declare + inject in one call. Call it
// AFTER the module's own replacements. early=true lands the block right after
// color_fragment (before alphahash_fragment, so alpha-hash materials fray for real);
// the default lands it just before lights_physical_fragment, after every module-side
// diffuseColor assignment, so nothing downstream can overwrite the stroke.
export function injectStrokes(sh, early = false) {
  Object.assign(sh.uniforms, { uStrokeK: styleUniforms.uStrokeK });
  const at = early ? '#include <color_fragment>' : '#include <lights_physical_fragment>';
  const rep = early ? at + '\n{' + STROKE_BODY + '}' : '{' + STROKE_BODY + '}\n' + at;
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\n' + STROKE_GLSL)
    .replace(at, rep);
}

// Dev surface.
if (typeof window !== 'undefined') window.__paint = { applyPaintLaw, styleUniforms, count: paintCount, G: GLASS };
