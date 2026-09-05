// Triplanar PBR sediment detail — loader + GLSL. OWNED BY: terrain agent.
//
// The three AmbientCG sets are channel-packed so the whole system costs five texture
// units instead of nine: albedo and roughness are pure structure (greyscale, level-
// normalised to a 0.5 mean at bake time), so silt/sediment/rock ride in R/G/B of one
// map each. Only the normal maps need their own RGB and stay separate.
//
// Everything here is STRUCTURE. Colour comes from the caller's zone palette — the
// shader helpers below return values centred on 1.0 that are meant to be multiplied
// into an existing albedo, never to replace it.
import * as THREE from 'three';
import { maxAniso } from './textures.js';
import { styleUniforms, EDGE_GLSL } from './paint.js';

const BASE = 'assets/textures/';

let pending = 0, fadeT0 = 0;

// Ramps 0->1 once every map is decoded; multiplied into the detail contribution so
// the swap-in from three's 1x1 placeholder reads as a short fade, not a pop.
export const texAmt = { value: 0 };
function fade() {
  const k = Math.min(1, (performance.now() - fadeT0) / 450);
  texAmt.value = k * k * (3 - 2 * k);
  if (k < 1) requestAnimationFrame(fade);
}

function load(file) {
  pending++;
  const t = new THREE.TextureLoader().load(BASE + file, () => {
    if (--pending === 0) { fadeT0 = performance.now(); fade(); }
  }, undefined, () => { if (--pending === 0) { texAmt.value = 0; } });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso();
  // All five maps are non-colour data: packed structure masks and tangent normals.
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Loaded asynchronously; nothing here blocks first render.
export const PBR = {
  albedo: load('albedo_pack.jpg'),   // R silt, G sediment, B rock
  rough:  load('rough_pack.jpg'),    // R silt, G sediment, B rock
  nSilt:  load('normal_silt.jpg'),
  nSed:   load('normal_sediment.jpg'),
  nRock:  load('normal_rock.jpg')
};

export const pbrUniforms = {
  uPAlb: { value: PBR.albedo },
  uPRgh: { value: PBR.rough },
  uPNS: { value: PBR.nSilt },
  uPNG: { value: PBR.nSed },
  uPNR: { value: PBR.nRock },
  uTexAmt: texAmt,
  // Style dial (lib/paint.js): edge-not-middle flattening + the paint floor, shared objects.
  uEdgeK: styleUniforms.uEdgeK, uEdgeSun: styleUniforms.uEdgeSun, uPaintK: styleUniforms.uPaintK
};

// ---------------------------------------------------------------------------
// GLSL. Two octaves at 1/8u and 1/45u world scale; the mix factor is driven by a
// ~140m field so the near tile never repeats in phase with itself, and the two
// scales are only ever near 50/50 inside narrow transition bands (a constant 0.5
// blend would halve contrast everywhere).
// ---------------------------------------------------------------------------
export const PBR_GLSL = EDGE_GLSL + /* glsl */`
uniform sampler2D uPAlb, uPRgh, uPNS, uPNG, uPNR;
uniform float uTexAmt; uniform float uPaintK;

const float PBR_NEAR = 0.125;   // 1 repeat / 8 world units
const float PBR_FAR  = 0.0222;  // 1 repeat / 45 world units

// One projection plane, both octaves. Flat ground takes the early out and pays
// two taps; only cliff faces pay all six.
vec3 pbrPlane(sampler2D t, vec3 p, vec3 bw, float f) {
  vec3 a = texture2D(t, p.xz * PBR_NEAR).rgb;
  vec3 b = texture2D(t, p.xz * PBR_FAR).rgb;
  vec3 s = mix(a, b, f);
  if (bw.y > 0.93) return s;
  vec3 sx = mix(texture2D(t, p.zy * PBR_NEAR).rgb, texture2D(t, p.zy * PBR_FAR).rgb, f);
  vec3 sz = mix(texture2D(t, p.xy * PBR_NEAR).rgb, texture2D(t, p.xy * PBR_FAR).rgb, f);
  return s * bw.y + sx * bw.x + sz * bw.z;
}

// Tangent normals for the three sets are blended per plane BEFORE the planes are
// whiteout-blended: blending after would mix normals expressed in different frames.
vec3 pbrNrmUV(vec2 uv, vec3 w, float f) {
  vec3 v = vec3(0.0);
  if (w.x > 0.004) v += mix(texture2D(uPNS, uv * PBR_NEAR).xyz, texture2D(uPNS, uv * PBR_FAR).xyz, f) * w.x;
  if (w.y > 0.004) v += mix(texture2D(uPNG, uv * PBR_NEAR).xyz, texture2D(uPNG, uv * PBR_FAR).xyz, f) * w.y;
  if (w.z > 0.004) v += mix(texture2D(uPNR, uv * PBR_NEAR).xyz, texture2D(uPNR, uv * PBR_FAR).xyz, f) * w.z;
  return v * 2.0 - (w.x + w.y + w.z);
}

// Whiteout triplanar for the sediment normals, matching the convention the
// procedural rock normal already uses so the two can simply be summed.
vec3 pbrNormal(vec3 p, vec3 n, vec3 bw, vec3 w, float f, float str) {
  // EDGE-NOT-MIDDLE (lib/paint.js): relief contrast dissolves on lit faces of the
  // geometric normal, survives in the shadow/edge transitions. Identity at uEdgeK 0.
  str *= edgeFlat(n);
  vec3 ty = pbrNrmUV(p.xz, w, f);
  if (bw.y > 0.93) return vec3(ty.x * str, 0.0, ty.y * str);
  vec3 tx = pbrNrmUV(p.zy, w, f);
  vec3 tz = pbrNrmUV(p.xy, w, f);
  vec3 wx = vec3(tx.xy * str + n.zy, abs(tx.z) * n.x);
  vec3 wy = vec3(ty.xy * str + n.xz, abs(ty.z) * n.y);
  vec3 wz = vec3(tz.xy * str + n.xy, abs(tz.z) * n.z);
  return normalize(wx.zyx * bw.x + wy.xzy * bw.y + wz.xyz * bw.z) - n;
}
`;
